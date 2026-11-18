# -*- coding: utf-8 -*-
"""
版面归一：把 OCR 文本框还原成结构化订单行（表格 / 列表两种版式）。

背景（2026-11）：一份订单可能是**手写列表**（一行一个商品，品名+数量+单位连写，
甚至左右分栏），也可能是**表格截图**（一个商品占 5–6 个单元格）。原链路把每个文本框
当"一行"，表格单会被拆成几百条伪商品行。本模块先把框还原成"行 → 字段"，再交给
``pipeline`` 复用原有的 normalize / match，两种输入共用同一条主流程。

设计要点：
- 表格：先找表头（含「数量」「单位」等关键词），用表头 x 区间切列并给每列定角色，
  非商品列（终端/部门/金额/备注…）直接丢弃；
- 列表：按"大间隙"判断是否左右分栏，逐行把框拼回一行，再从**右往左**找
  「数字+数量单位」锚点提取数量，锚点右侧进备注；
- 规格与数量用**量纲**区分：kg/g/ml/L/克/升 → 规格；件/瓶/包/箱/桶/罐/盒/袋/个/斤… → 数量；
- 表头/日期/合计/部门等噪声行直接丢弃（记入 dropped，不污染三张表）。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from statistics import median

#: 数量单位（包装/计件类；kg、g、ml、L 等量纲属于规格，不在此列）
QTY_UNITS = ("件", "瓶", "包", "箱", "桶", "罐", "盒", "袋", "支", "个", "只", "斤",
             "块", "扎", "提", "板", "条", "把", "份", "颗", "根", "片", "束", "筒")

_QTY_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(" + "|".join(QTY_UNITS) + r")")
#: 名称尾部的包装规格：22.68kg / 1.9L*6瓶 / 500g*12瓶/盒 / 1x22.68kg / 180G
_SPEC_TAIL_RE = re.compile(
    r"(?P<spec>"
    r"(?:\d+(?:\.\d+)?\s*[*x×X]\s*\d+(?:\.\d+)?)?\s*"
    r"\d*(?:\.\d+)?\s*(?:千克|公斤|毫升|克|kg|KG|Kg|kG|g|G|ml|ML|mL|L|l|升)"
    r"(?:\s*[*x×X]\s*\d+\s*(?:瓶|包|袋|盒|罐|桶|件|箱|支|个|片|只|条|把)?)?"
    r"(?:\s*/\s*(?:盒|包|袋|箱|瓶|罐|桶|件|支|个|片))?"
    r")\s*$"
)

#: 表头关键词 -> 列角色（ignore 优先：如「商品部门」不能被「商品」抢成 name）
_ROLE_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("ignore", ("终端", "客户", "部门", "单价", "金额", "合计", "小计", "序号",
                "日期", "供应商", "附批检", "收货", "单号")),
    ("qty", ("数量", "订购数量", "件数", "重量")),
    ("unit", ("单位",)),
    ("spec", ("规格",)),
    ("remark", ("备注", "说明", "要求")),
    ("name", ("货品名称", "商品名称", "品名", "名称", "货品", "商品")),
)

#: 非商品行关键词（无数量时直接丢弃）
_JUNK_RE = re.compile(
    r"(采购订单|订单号|需求日期|送货|送到|送达|上午|下午|日期|合计|小计|总计|"
    r"终端|商品部门|附批检|备注[:：]|数量\s*单位|第\s*[一二三四五六七八九十\d]+\s*页|共\s*\d+\s*页)"
)
_DATE_RE = re.compile(r"^\s*\d{4}[.\-/年]\d{1,2}([.\-/月]\d{1,2})?\s*$")


def _has_cjk(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


def _char_width(boxes: list[dict]) -> float:
    """每个字符占的像素宽度（用来判断"大间隙"）。"""
    widths = [(b["x1"] - b["x0"]) / max(len(b["text"]), 1) for b in boxes if b["text"]]
    return median(widths) if widths else 12.0


def group_rows(boxes: list[dict], tol_ratio: float = 0.6) -> list[dict]:
    """按 y 中心把框聚成行；返回 ``[{"cy": float, "boxes": [...]}, ...]``（行内按 x 排序）。"""
    if not boxes:
        return []
    heights = [b["y1"] - b["y0"] for b in boxes if b["y1"] > b["y0"]]
    tol = max(4.0, (median(heights) if heights else 20.0) * tol_ratio)
    rows: list[dict] = []
    for box in sorted(boxes, key=lambda b: (b["cy"], b["x0"])):
        if rows and abs(box["cy"] - rows[-1]["cy"]) <= tol:
            row = rows[-1]
            row["boxes"].append(box)
            row["cy"] = sum(b["cy"] for b in row["boxes"]) / len(row["boxes"])
        else:
            rows.append({"cy": box["cy"], "boxes": [box]})
    for row in rows:
        row["boxes"].sort(key=lambda b: b["x0"])
    return rows


def split_cells(boxes: list[dict], gap: float) -> list[list[dict]]:
    """行内按 x 间隙切格：相邻框间距 > gap 就断一刀。"""
    cells: list[list[dict]] = []
    for box in sorted(boxes, key=lambda b: b["x0"]):
        if cells and box["x0"] - cells[-1][-1]["x1"] <= gap:
            cells[-1].append(box)
        else:
            cells.append([box])
    return cells


def find_gutter(boxes: list[dict], page_w: float,
                min_gap_ratio: float = 0.04, min_side_ratio: float = 0.2) -> float | None:
    """找左右分栏的竖直空白带（只在**没有表头**时使用），返回分栏 x 坐标。"""
    if len(boxes) < 6:
        return None
    intervals = sorted((b["x0"], b["x1"]) for b in boxes)
    merged = [list(intervals[0])]
    for x0, x1 in intervals[1:]:
        if x0 <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], x1)
        else:
            merged.append([x0, x1])
    need = max(3, int(len(boxes) * min_side_ratio))
    best = None
    for i in range(len(merged) - 1):
        gap = merged[i + 1][0] - merged[i][1]
        if gap < page_w * min_gap_ratio:
            continue
        cut = (merged[i][1] + merged[i + 1][0]) / 2
        left = sum(1 for b in boxes if b["x1"] <= merged[i][1] + 1)
        right = sum(1 for b in boxes if b["x0"] >= merged[i + 1][0] - 1)
        if left < need or right < need:
            continue
        if best is None or gap > best[0]:
            best = (gap, cut)
    return best[1] if best else None


def _role(label: str) -> str:
    text = (label or "").strip()
    for role, keys in _ROLE_KEYWORDS:
        if any(k in text for k in keys):
            return role
    return "other"


def _merge_header_cells(cells: list[list[dict]]) -> list[list[dict]]:
    """表头里被 OCR 拆开的相邻格（如「数」「量」）按关键词合并回去。"""
    merged: list[list[dict]] = []
    for cell in cells:
        if merged:
            left, right = merged[-1], cell
            left_text = "".join(b["text"] for b in left)
            right_text = "".join(b["text"] for b in right)
            if _role(left_text) == "other" and _role(right_text) == "other" \
                    and _role(left_text + right_text) != "other":
                merged[-1] = left + right
                continue
        merged.append(cell)
    return merged


def _find_header(rows: list[dict], char_w: float) -> tuple[int, list[list[dict]]] | None:
    """找表头行：≥3 个单元格且命中 ≥2 个列名关键词。

    表头单元格之间可能只隔 1px（如「数量」「单位」紧贴），因此用很小的间隙阈值切分，
    再把被拆开的相邻同义词格合并回去。
    """
    best = None
    for idx, row in enumerate(rows):
        cells = split_cells(row["boxes"], gap=max(0.5, char_w * 0.05))
        cells = _merge_header_cells(cells)
        if len(cells) < 3:
            continue
        labels = ["".join(b["text"] for b in cell) for cell in cells]
        roles = [_role(lab) for lab in labels]
        hits = sum(1 for r in roles if r != "other")
        if hits >= 2 and ("name" in roles or "qty" in roles):
            score = (hits, len(cells))
            if best is None or score > best[0]:
                best = (score, idx, cells)
    if best is None:
        return None
    return best[1], best[2]


def _columns(header_cells: list[list[dict]], page_w: float) -> list[dict]:
    """把表头单元格转成列区间 + 角色。"""
    spans = []
    for cell in header_cells:
        label = "".join(b["text"] for b in cell)
        spans.append((min(b["x0"] for b in cell), max(b["x1"] for b in cell), label))
    cols = []
    for i, (x0, x1, label) in enumerate(spans):
        lo = 0.0 if i == 0 else (spans[i - 1][1] + x0) / 2
        hi = page_w if i == len(spans) - 1 else (x1 + spans[i + 1][0]) / 2
        cols.append({"lo": lo, "hi": hi, "role": _role(label), "label": label})
    return cols


def split_spec_tail(name: str) -> tuple[str, str]:
    """把名称末尾的包装规格（1.9L / 25KG / 300克 / 1.9L*6瓶 / 1x22.68kg）拆出来。"""
    text = (name or "").strip()
    m = _SPEC_TAIL_RE.search(text)
    if m:
        head = text[: m.start()].strip(" ，,、;；:：*x×/")
        if len(head) >= 2 and _has_cjk(head):
            return head, m.group("spec").replace(" ", "")
    return text.strip(" *x×/"), ""


def _confidence(name: str, spec: str, qty: str, unit: str) -> float:
    score = 0.0
    if qty and _plausible_qty(qty):
        score += 0.4
    if unit in QTY_UNITS:
        score += 0.3
    if len(re.findall(r"[\u4e00-\u9fff]", name or "")) >= 2:
        score += 0.2
    if spec or not re.search(r"\d", name or ""):
        score += 0.1
    score = min(score, 1.0)
    # P3：数量缺失 / 为 0 / 大得离谱 -> 降到审核阈值以下，不自动放行
    if not qty:
        score = min(score, 0.5)
    elif not _plausible_qty(qty):
        score = min(score, 0.45)
    return round(score, 2)


def _plausible_qty(qty: str) -> bool:
    """数量是否可信：>0 且 <=1000（"0包""江0包"这类要进审核）。"""
    try:
        value = float(qty)
    except (TypeError, ValueError):
        return False
    return 0 < value <= 1000


def _merge_wrapped_rows(rows: list[dict]) -> list[dict]:
    """把一个商品**换行写**的情况接回去：上一行只有名字，下一行以数量开头。

    与"相邻两行合并"不冲突：合行本身仍然允许（用户可能把名字写长换行），
    这里只是补上"名字行 + 数量行"的接续，避免名字行被当成无数量记录。
    """
    merged: list[dict] = []
    for row in rows:
        text = "".join(b["text"] for b in row["boxes"]).strip()
        if merged:
            prev_text = "".join(b["text"] for b in merged[-1]["boxes"]).strip()
            if (_has_cjk(prev_text) and not _QTY_RE.search(prev_text)
                    and _QTY_RE.match(text)):
                merged[-1]["boxes"].extend(row["boxes"])
                merged[-1]["cy"] = (merged[-1]["cy"] + row["cy"]) / 2
                continue
        merged.append({"cy": row["cy"], "boxes": list(row["boxes"])})
    return merged


def _split_item_segments(text: str) -> list[str]:
    """一行里出现 ≥2 个「数字+数量单位」锚点时，按锚点切成多条商品。

    场景：用户把两件商品写在同一行，或行聚类把相邻两行并成一行。
    切出来的每段都由自己的锚点决定数量/单位，不会"只保留最后一个"。
    """
    raw = (text or "").strip()
    anchors = list(_QTY_RE.finditer(raw))
    if len(anchors) < 2:
        return [raw] if raw else []
    segments: list[str] = []
    prev = 0
    for match in anchors:
        seg = raw[prev:match.end()].strip()
        if seg:
            segments.append(seg)
        prev = match.end()
    tail = raw[prev:].strip()
    if tail:
        if segments:
            segments[-1] = f"{segments[-1]}{tail}"
        else:
            segments.append(tail)
    return segments


#: 手写里常见的"单位近形字"（抱/伴/泮… 其实是 包/件/瓶），只紧跟数字时替换
_UNIT_CONFUSIONS = {
    "抱": "包", "伴": "件", "泮": "瓶", "体": "件", "炮": "包", "仓": "箱",
    "色": "包", "销": "桶", "折": "斤", "今": "斤", "听": "斤", "介": "件",
    "佯": "件", "供": "件", "葙": "箱", "鑵": "罐", "礶": "罐",
}
_UNIT_FIX_RE = re.compile(r"(?<=\d)\s*(" + "|".join(_UNIT_CONFUSIONS) + r")")


def _normalize_units(text: str) -> str:
    """把手写常见的单位近形字纠正回来（“5抱”-> “5包”），只作用于紧跟数字的位置。"""
    return _UNIT_FIX_RE.sub(lambda m: _UNIT_CONFUSIONS[m.group(1)], text or "")


def _split_row_by_gap(row: dict, char_w: float) -> list[dict]:
    """把一行按**大水平间隙**切成多段（左右两栏同 y 时不再互相污染）。"""
    boxes = sorted(row["boxes"], key=lambda b: b["x0"])
    if len(boxes) < 2:
        return [row]
    threshold = max(3.0 * char_w, 36.0)
    segments, current = [], [boxes[0]]
    for prev, cur in zip(boxes, boxes[1:]):
        if cur["x0"] - prev["x1"] > threshold:
            segments.append(current)
            current = [cur]
        else:
            current.append(cur)
    segments.append(current)
    if len(segments) == 1:
        return [row]
    return [{"cy": row["cy"], "boxes": seg} for seg in segments]


def find_gutter_by_vote(rows: list[dict], char_w: float,
                        min_support: float = 0.5) -> float | None:
    """按行投票找左右分栏位置：单行有横跨框也拖不垮（P2）。"""
    from collections import Counter

    votes: Counter = Counter()
    rows_with_gap = 0
    threshold = max(3.0 * char_w, 36.0)
    for row in rows:
        boxes = sorted(row["boxes"], key=lambda b: b["x0"])
        if len(boxes) < 2:
            continue
        gap, idx = max(((boxes[i + 1]["x0"] - boxes[i]["x1"], i) for i in range(len(boxes) - 1)),
                       key=lambda x: x[0])
        if gap < threshold:
            continue
        rows_with_gap += 1
        votes[round((boxes[idx]["x1"] + boxes[idx + 1]["x0"]) / 2 / 20)] += 1
    if rows_with_gap < 2:
        return None
    bucket, count = votes.most_common(1)[0]
    if count < rows_with_gap * min_support:
        return None
    return float(bucket * 20)


def _list_records(rows: list[dict], char_w: float) -> tuple[list[dict], list[str]]:
    records, dropped = [], []
    for row in _merge_wrapped_rows(rows):
        for seg_row in _split_row_by_gap(row, char_w):
            text = _normalize_units("".join(b["text"] for b in seg_row["boxes"]))
            for segment in _split_item_segments(text):
                rec = parse_list_line(segment)
                if _is_junk(rec):
                    dropped.append(segment)
                    continue
                records.append(rec)
    return records, dropped


def parse_list_line(text: str) -> dict:
    """列表版式：从右往左找「数字+数量单位」锚点，切出品名 / 数量 / 备注。"""
    raw = (text or "").strip()
    cleaned = _normalize_units(raw.strip(" ，,、;；:："))
    matches = list(_QTY_RE.finditer(cleaned))
    qty, unit, name, remark = "", "", cleaned, ""
    if matches:
        m = matches[-1]
        qty = m.group(1)
        unit = m.group(2)
        name = cleaned[: m.start()].strip(" ，,、;；:：(")
        remark = cleaned[m.end():].strip(" ，,、;；:：")
    name, spec = split_spec_tail(name)
    return {
        "raw": raw, "name": name, "spec": spec, "qty": qty, "unit": unit,
        "remark": remark, "conf": _confidence(name, spec, qty, unit),
    }


def _is_junk(rec: dict) -> bool:
    name = rec["name"]
    if not name or len(name) < 2 or not _has_cjk(name):
        return True
    if _DATE_RE.match(name) or _DATE_RE.match(rec["raw"]):
        return True
    if name.startswith(("合计", "小计", "总计")):
        return True
    if not rec["qty"] and not rec["unit"] and _JUNK_RE.search(rec["raw"]):
        return True
    return False


def _is_number(text: str) -> bool:
    t = (text or "").strip().replace(" ", "")
    return bool(re.fullmatch(r"\d+(?:\.\d+)?", t)
                or re.fullmatch(r"\d+(?:\.\d+)?(?:%s)" % "|".join(QTY_UNITS), t))


def _type_cost(text: str, role: str) -> float:
    """单元格内容与列角色的匹配代价（0 最合适，越大越不可能）。"""
    t = (text or "").strip()
    number, cjk = _is_number(t), _has_cjk(t)
    if role == "ignore":
        # 数字落到「序号/单价」这类列也合理，但要比落到「数量」略贵，
        # 否则斜拍时数量会被序号/单价抢走。
        if number:
            return 0.35
        return 0.0 if len(t) <= 6 else 1.2
    if role == "name":
        return 0.0 if (cjk and not number) else 3.5
    if role == "qty":
        return 0.0 if number else 3.5
    if role == "unit":
        return 0.0 if t in QTY_UNITS else 3.0
    if role == "remark":
        return 0.4 if cjk else 2.0
    if role == "spec":
        return 1.0
    return 1.5


_SKIP_COST = 0.8


def _align_cells(cells: list[dict], cols: list[dict]) -> list[tuple[dict, dict]]:
    """把一行的单元格**按顺序**对齐到表头列（允许跳过空列），返回 [(cell, col), ...]。

    用 DP 做单调对齐：代价 = 内容类型是否像该列 + 很小的行内相对位置项。
    这样即使斜拍/透视让整行 x 漂移（各列漂移量还不一致），靠"品名是中文、数量是数字、
    单位是单位词"也能把列认对，比固定 x 边界或按比例缩放都稳。
    """
    n, m = len(cells), len(cols)
    if n == 0:
        return []
    xs = [c["cx"] for c in cells]
    lo_cell, hi_cell = min(xs), max(xs)
    span_cell = (hi_cell - lo_cell) or 1.0
    lo_col = min(c["lo"] for c in cols)
    span_col = (max(c["hi"] for c in cols) - lo_col) or 1.0
    inf = float("inf")
    dp = [[inf] * (m + 1) for _ in range(n + 1)]
    back: list[list[str | None]] = [[None] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0.0
    for j in range(1, m + 1):
        dp[0][j] = dp[0][j - 1] + _SKIP_COST
        back[0][j] = "skip"
    for i in range(1, n + 1):
        u_cell = (cells[i - 1]["cx"] - lo_cell) / span_cell
        for j in range(1, m + 1):
            u_col = ((cols[j - 1]["lo"] + cols[j - 1]["hi"]) / 2 - lo_col) / span_col
            cost = _type_cost(cells[i - 1]["text"], cols[j - 1]["role"]) + 0.25 * abs(u_cell - u_col)
            if dp[i - 1][j - 1] + cost < dp[i][j]:
                dp[i][j] = dp[i - 1][j - 1] + cost
                back[i][j] = "match"
            if dp[i][j - 1] + _SKIP_COST < dp[i][j]:
                dp[i][j] = dp[i][j - 1] + _SKIP_COST
                back[i][j] = "skip"
    if dp[n][m] == inf:                       # 单元格比列还多：退回顺序映射
        return list(zip(cells, cols[-n:] if n <= m else cols))
    pairs = []
    i, j = n, m
    while i > 0 or j > 0:
        action = back[i][j]
        if action == "match":
            pairs.append((cells[i - 1], cols[j - 1]))
            i, j = i - 1, j - 1
        else:
            j -= 1
    pairs.reverse()
    return pairs


def _heuristic_row(row_cells: list[dict]) -> dict | None:
    """兜底：不依赖列边界，直接从一行单元格猜 品名/数量/单位/备注。

    数量取"离单位格最近的那个数字"（表格里序号/单价也是数字，不能取第一个/最后一个）。
    """
    names = [c["text"].strip() for c in row_cells
             if _has_cjk(c["text"]) and not _is_number(c["text"])]
    if not names:
        return None
    name_text = max(names, key=len)
    unit_cell = next((c for c in row_cells if c["text"].strip() in QTY_UNITS), None)
    nums = [c for c in row_cells if _is_number(c["text"])]
    qty_cell = None
    if nums:
        qty_cell = (min(nums, key=lambda c: abs(c["cx"] - unit_cell["cx"]))
                    if unit_cell is not None else nums[-1])
    qty_text = qty_cell["text"].strip() if qty_cell else ""
    unit_text = unit_cell["text"].strip() if unit_cell else ""
    used = {name_text, qty_text, unit_text}
    remark = "".join(c["text"].strip() for c in row_cells
                     if c["text"].strip() not in used
                     and _has_cjk(c["text"]) and not _is_number(c["text"]))
    qty_num = re.search(r"\d+(?:\.\d+)?", qty_text)
    name, spec = split_spec_tail(name_text)
    qty = qty_num.group(0) if qty_num else ""
    return {"name": name, "spec": spec, "qty": qty, "unit": unit_text, "remark": remark}


def _table_records(rows: list[dict], header_idx: int, cols: list[dict],
                   char_w: float) -> tuple[list[dict], list[str], list[dict]]:
    records, dropped, unparsed = [], [], []
    for row in rows[header_idx + 1:]:
        cells = [{"text": "".join(b["text"] for b in cell), "cx": sum(b["cx"] for b in cell) / len(cell)}
                 for cell in split_cells(row["boxes"], gap=max(6.0, char_w))]
        if not cells:
            continue
        buckets: dict[str, list[str]] = {}
        for cell, col in _align_cells(cells, cols):
            if col["role"] != "ignore":
                buckets.setdefault(col["role"], []).append(cell["text"])

        name_text = "".join(buckets.get("name", [])).strip()
        qty_text = "".join(buckets.get("qty", [])).strip()
        unit_text = "".join(buckets.get("unit", [])).strip()
        remark = "".join(buckets.get("remark", [])).strip()
        spec_text = "".join(buckets.get("spec", [])).strip()
        if not name_text:                      # 列没对齐（常见于斜拍/透视）：走兜底
            guess = _heuristic_row(cells)
            if guess:
                name_text = guess["name"]
                qty_text = qty_text or guess["qty"]
                unit_text = unit_text or guess["unit"]
                remark = remark or guess["remark"]
                spec_text = spec_text or guess["spec"]
        raw = " ".join("".join(c["text"] for c in cells).split())
        if not name_text:
            if _has_cjk(raw):
                unparsed.append({"raw": raw, "reason": "品名列未对齐且无可用品名"})
            else:
                dropped.append(raw)
            continue

        qty_match = re.search(r"\d+(?:\.\d+)?", qty_text)
        qty = qty_match.group(0) if qty_match else ""
        unit = unit_text or re.sub(r"^[\d.\s]+", "", qty_text).strip()
        unit = unit.strip()
        name, spec = split_spec_tail(name_text)
        if not spec and spec_text:
            spec = spec_text
        rec = {
            "raw": " ".join(p for p in (name_text, f"{qty}{unit}".strip(), remark) if p),
            "name": name, "spec": spec, "qty": qty, "unit": unit,
            "remark": remark, "conf": _confidence(name, spec, qty, unit),
        }
        if _is_junk(rec):
            dropped.append(rec["raw"] or raw)
            continue
        records.append(rec)
    return records, dropped, unparsed


def _heuristic_table_records(rows: list[dict], char_w: float) -> tuple[list[dict], list[str], list[dict]]:
    """没有表头时的表格兜底：纯数字格=数量、单位词格=单位、最长文本格=品名。"""
    records, dropped, unparsed = [], [], []
    for row in rows:
        cells = split_cells(row["boxes"], gap=max(6.0, char_w * 1.5))
        if len(cells) < 3:
            continue
        texts = ["".join(b["text"] for b in cell).strip() for cell in cells]
        qty_idx = next((i for i, t in enumerate(texts) if re.fullmatch(r"\d+(?:\.\d+)?", t)), None)
        unit_idx = next((i for i, t in enumerate(texts) if t in QTY_UNITS), None)
        if qty_idx is None or unit_idx is None or qty_idx == unit_idx:
            raw = " ".join(texts)
            guess = _heuristic_row([{"text": t, "cx": 0.0} for t in texts])
            if guess:
                rec = {**guess, "raw": raw,
                       "conf": _confidence(guess["name"], guess["spec"], guess["qty"], guess["unit"])}
                if not _is_junk(rec):
                    records.append(rec)
                    continue
            if _has_cjk(raw):
                unparsed.append({"raw": raw, "reason": "无数量/单位列可对齐"})
            else:
                dropped.append(raw)
            continue
        name_candidates = [(len(t), i, t) for i, t in enumerate(texts)
                           if i not in (qty_idx, unit_idx) and _has_cjk(t)]
        if not name_candidates:
            dropped.append(" ".join(texts))
            continue
        _, name_idx, name_text = max(name_candidates)
        remark = "".join(t for i, t in enumerate(texts)
                         if i not in (qty_idx, unit_idx, name_idx))
        name, spec = split_spec_tail(name_text)
        rec = {
            "raw": " ".join(t for t in (name_text, f"{texts[qty_idx]}{texts[unit_idx]}", remark) if t),
            "name": name, "spec": spec, "qty": texts[qty_idx], "unit": texts[unit_idx],
            "remark": remark,
            "conf": _confidence(name, spec, texts[qty_idx], texts[unit_idx]),
        }
        if _is_junk(rec):
            dropped.append(rec["raw"])
            continue
        records.append(rec)
    return records, dropped, unparsed


@dataclass
class Document:
    """一页单据的版面解析结果。"""

    kind: str                       # table | list
    records: list[dict] = field(default_factory=list)
    dropped: list[str] = field(default_factory=list)
    unparsed: list[dict] = field(default_factory=list)   # 有内容但没解析出商品名的行
    boxes: list[dict] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.records)


def build_records(boxes: list[dict], force: str | None = None) -> Document:
    """纯函数：文本框 -> 结构化记录（不依赖 OCR，便于单测）。

    force：``table`` / ``list`` 可强制版式；``None`` 为自动判别。
    """
    if not boxes:
        return Document(kind="list", boxes=[])
    page_w = max(b["x1"] for b in boxes)
    rows = group_rows(boxes)
    char_w = _char_width(boxes)

    header = None if force == "list" else _find_header(rows, char_w)
    if header is not None:
        header_idx, header_cells = header
        cols = _columns(header_cells, page_w)
        records, dropped, unparsed = _table_records(rows, header_idx, cols, char_w)
        return Document(kind="table", records=records, dropped=dropped,
                        unparsed=unparsed, boxes=boxes)

    if force == "table":
        records, dropped, unparsed = _heuristic_table_records(rows, char_w)
        return Document(kind="table", records=records, dropped=dropped,
                        unparsed=unparsed, boxes=boxes)

    # 没有表头：先按"行投票"找左右分栏（P2），找不到再用全局 x 空隙兜底
    gutter = find_gutter_by_vote(rows, char_w) or find_gutter(boxes, page_w)
    segments = [boxes] if gutter is None else [
        [b for b in boxes if b["cx"] < gutter],
        [b for b in boxes if b["cx"] >= gutter],
    ]
    records, dropped = [], []
    for seg in segments:
        seg_rows = group_rows(seg)
        recs, drop = _list_records(seg_rows, char_w)
        records.extend(recs)
        dropped.extend(drop)
    return Document(kind="list", records=records, dropped=dropped, boxes=boxes)


def parse_document(image_path_or_url: str, force: str | None = None) -> Document:
    """图片（本地路径 / http 直链）-> :class:`Document`。"""
    from .ocr import ocr_boxes

    return build_records(ocr_boxes(image_path_or_url), force=force)
