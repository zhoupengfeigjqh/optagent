"""
核心流水线：analyze_order（识别+标准化+匹配分流）与 finalize_order（审核合成导出）。
这两个函数都是纯函数：不持有跨调用状态、不感知运行模式，CLI 与 MCP 共用。
本模块不存在 session_id / OrderSessionStore / 任何跨 MCP 调用的内存状态。
"""

from __future__ import annotations
import re
from . import config
from .excel_export import build_combined_workbook, build_split_files
from .matcher import match_name
from .normalize import normalize_item

# 把订单文字拆成「行」的分隔符：标点 + 并列连词（和/及/跟/与/加/还有）。
# 这样「土豆和白菜」「花菜还有胡萝卜」这类一行多商品会被拆成多条，分别标准化+匹配，避免未命中的商品被整体命中行吞掉。
_SPLIT_RE = re.compile(r"[\n\r，,·、;；。]+|还有|和|及|跟|与|加")


def _split_text_lines(text: str) -> list[str]:
    return [ln.strip() for ln in _SPLIT_RE.split(text or "") if ln.strip()]


def analyze_order(text: str, image_path: str | None, data_df_dict: dict):
    """
    识别订单文字/图片，返回 (auto_rows, review_rows, error_rows)。
    - text：订单文字（可多行，可含中文逗号/顿号分隔）；
    - image_path：订单图片本地路径或 URL（可选，走 OCR）；
    - data_df_dict：load_product_data 返回的 {"sku", "synonyms", "noise"}。
    """
    chunks: list[str] = []
    if image_path:
        from .ocr import OcrError, ocr_lines

        try:
            chunks.extend(ocr_lines(image_path))
        except OcrError as exc:
            # OCR 失败不抛异常，作为一条异常记录返回（保证 MCP 侧可读）
            return [], [], [{
                "raw_line": "", "normalized_name": "", "quantity": None,
                "error_type": "OCR_EMPTY", "top_candidate": None, "top_score": None,
                "message": f"OCR 失败：{exc}",
            }]
    if text:
        chunks.append(text)

    # 对每一块（OCR 行 / 文本）再按标点 + 并列连词拆成单条商品行
    lines: list[str] = []
    for chunk in chunks:
        lines.extend(_split_text_lines(chunk))

    auto_rows: list[dict] = []
    review_rows: list[dict] = []
    error_rows: list[dict] = []
    for raw in lines:
        if not raw.strip():
            continue
        norm = normalize_item(raw, data_df_dict["synonyms"], data_df_dict["noise"])
        base = {
            "raw_line": raw,
            "normalized_name": norm["normalized_name"],
            "quantity": norm["quantity"],
            "unit": norm["unit"],
            "removed_tokens": norm["removed_tokens"],
            "synonym_applied": norm["synonym_applied"],
            "loose_applied": norm["loose_applied"],
        }
        if norm["status"] == "empty":
            error_rows.append({
                **base, "error_type": "OCR_EMPTY",
                "top_candidate": None, "top_score": None,
                "message": "标准化后名称为空",
            })
            continue

        m = match_name(norm["normalized_name"], data_df_dict["sku"])
        if m["result"] == "auto":
            auto_rows.append({
                **base, "matched_name": m["matched_name"],
                "sku_id": m["sku_id"], "score": m["score"],
            })
        elif m["result"] == "review":
            review_rows.append({
                **base, "index": len(review_rows),
                "top_score": m["top_score"], "candidates": m["candidates"],
            })
        else:
            error_rows.append({
                **base, "error_type": m["error_type"],
                "top_candidate": m["top_candidate"], "top_score": m["top_score"],
                "candidates": m.get("candidates", []),
                "message": _error_message(m),
            })
    return auto_rows, review_rows, error_rows


def _error_message(m: dict) -> str:
    if m["error_type"] == "NO_SKU_MATCH":
        return "未匹配到任何启用商品"
    return "置信度过低、无可用候选，需人工处理"


def analyze_batch(orders, data_df_dict):
    """
    批量分析多个独立订单。
    orders：[(source, text, image_path), ...]，每个元素是一个订单（文字或图片二选一）。
    返回合并后的 (auto_rows, review_rows, error_rows)，每行带：
      order_no —— 订单编号（从 1 起，每张图/每段文字 = 一个订单）
      source   —— 来源（文件名 / 「文本」）
    review 行的 index 全局重排，供统一审核时 decisions 使用。
    """
    auto_rows: list[dict] = []
    review_rows: list[dict] = []
    error_rows: list[dict] = []
    for order_no, (source, text, image_path) in enumerate(orders, start=1):
        a, r, e = analyze_order(text, image_path, data_df_dict)
        for row in a:
            row["order_no"] = order_no
            row["source"] = source
            auto_rows.append(row)
        for row in r:
            row["order_no"] = order_no
            row["source"] = source
            row["index"] = len(review_rows)  # 全局重排
            review_rows.append(row)
        for row in e:
            row["order_no"] = order_no
            row["source"] = source
            error_rows.append(row)
    return auto_rows, review_rows, error_rows


def resolve_manual_product(text: str, data_df_dict: dict) -> dict | None:
    """
    把审核人手动输入的正确商品文字匹配到 SKU。
    返回 {"name", "sku_id", "score"} 或 None（未匹配）。
    优先取 auto 结果；review/error 时取候选最高分（审核人已明确指定，可接受低分）。
    """
    norm = normalize_item(text, data_df_dict["synonyms"], data_df_dict["noise"])
    if norm["status"] != "ok" or not norm["normalized_name"]:
        return None
    m = match_name(norm["normalized_name"], data_df_dict["sku"])
    if m["result"] == "auto":
        return {"name": m["matched_name"], "sku_id": m["sku_id"], "score": m["score"]}
    cands = m.get("candidates") or []
    if cands:
        return {"name": cands[0]["name"], "sku_id": cands[0]["sku_id"], "score": cands[0]["score"]}
    return None


def _review_to_error(row: dict, error_type: str, message: str) -> dict:
    """把 review 行转成异常记录行（REVIEW_REJECTED / REVIEW_PENDING）。"""
    candidates = row.get("candidates", [])
    top = candidates[0] if candidates else None
    return {
        "order_no": row.get("order_no"),
        "source": row.get("source"),
        "raw_line": row.get("raw_line"),
        "normalized_name": row.get("normalized_name"),
        "quantity": row.get("quantity"),
        "error_type": error_type,
        "top_candidate": top["name"] if top else None,
        "top_score": top["score"] if top else row.get("top_score"),
        "message": message,
    }


def _audit_note(row: dict) -> str:
    """生成审核标记：loose 映射 / 同义词 / 剥离词。"""
    parts: list[str] = []
    if row.get("loose_applied"):
        parts.append("loose映射")
    if row.get("synonym_applied"):
        parts.append(row["synonym_applied"])
    if row.get("removed_tokens"):
        parts.append("剥离:" + "、".join(row["removed_tokens"]))
    return "；".join(parts)


def apply_decisions(review_rows: list[dict], decisions: list[dict]):
    """
    把人工决策应用到 review_rows，返回 (confirmed_rows, rejected_rows, pending_rows)。
    规则：
    - 未被 decisions 覆盖的行 -> REVIEW_PENDING；
    - action="confirm" 且 chosen_candidate_idx 合法 -> 确认（进入审核通过）；
    - action="reject" -> REVIEW_REJECTED；
    - confirm 缺少/越界 chosen_candidate_idx -> REVIEW_REJECTED（非法决策）；
    - action 不是 confirm/reject -> REVIEW_PENDING（非法 action）；
    - row_index 非 int 或越界 -> 忽略（无法定位到行）。
    """
    confirmed: list[dict] = []
    rejected: list[dict] = []
    pending: list[dict] = []

    decision_map: dict[int, dict] = {}
    for d in decisions or []:
        idx = d.get("row_index") if isinstance(d, dict) else None
        if isinstance(idx, bool) or not isinstance(idx, int):
            continue
        if not (0 <= idx < len(review_rows)):
            continue
        decision_map.setdefault(idx, d)  # 首个生效

    for i, row in enumerate(review_rows):
        d = decision_map.get(i)
        if d is None:
            pending.append(_review_to_error(row, "REVIEW_PENDING", "未审核，待人工处理"))
            continue
        action = d.get("action")
        chosen = d.get("chosen_candidate_idx")
        candidates = row.get("candidates", [])
        if action == "reject":
            rejected.append(_review_to_error(row, "REVIEW_REJECTED", "审核拒绝"))
        elif action == "confirm":
            if (isinstance(chosen, int) and not isinstance(chosen, bool)
                    and 0 <= chosen < len(candidates)):
                cand = candidates[chosen]
                confirmed.append({
                    "order_no": row.get("order_no"),
                    "source": row.get("source"),
                    "raw_line": row.get("raw_line"),
                    "normalized_name": row.get("normalized_name"),
                    "quantity": row.get("quantity"),
                    "unit": row.get("unit"),
                    "matched_name": cand["name"],
                    "sku_id": cand["sku_id"],
                    "score": cand["score"],
                    "audit_note": _audit_note(row),
                })
            else:
                rejected.append(_review_to_error(
                    row, "REVIEW_REJECTED",
                    f"非法决策：confirm 缺少或越界 chosen_candidate_idx（{chosen}）"))
        elif action == "confirm_manual":
            # 审核人主动输入的正确商品（不在候选里也能确认）
            matched_name = d.get("matched_name")
            sku_id = d.get("sku_id")
            if matched_name and sku_id:
                confirmed.append({
                    "order_no": row.get("order_no"),
                    "source": row.get("source"),
                    "raw_line": row.get("raw_line"),
                    "normalized_name": row.get("normalized_name"),
                    "quantity": row.get("quantity"),
                    "unit": row.get("unit"),
                    "matched_name": matched_name,
                    "sku_id": sku_id,
                    "score": d.get("score"),
                    "audit_note": "人工指定商品",
                })
            else:
                rejected.append(_review_to_error(
                    row, "REVIEW_REJECTED",
                    "非法决策：confirm_manual 缺少 matched_name/sku_id"))
        else:
            pending.append(_review_to_error(
                row, "REVIEW_PENDING", f"非法 action：{action}，按待审核处理"))
    return confirmed, rejected, pending


def finalize_order(auto_rows, review_rows, error_rows, decisions, split_files: bool = False) -> dict:
    """
    合成三表并导出 Excel。返回字典（含文件字节），可被 CLI 写盘、被 MCP base64 返回。
    返回字段：
      combined_filename / combined_file（bytes）或 files（三个独立文件）
      auto_count / confirmed_count / rejected_count / pending_count / error_count
    """
    confirmed, rejected, pending = apply_decisions(review_rows, decisions)
    # 异常记录 = 原 error_rows + 拒绝 + 待审核（未审核行不被丢弃）
    all_error_rows = list(error_rows) + rejected + pending

    result = {
        "auto_count": len(auto_rows),
        "confirmed_count": len(confirmed),
        "rejected_count": len(rejected),
        "pending_count": len(pending),
        "error_count": len(error_rows),
    }
    if split_files:
        files = build_split_files(auto_rows, confirmed, all_error_rows)
        result.update({"combined_filename": None, "combined_file": None, "files": files})
    else:
        result.update({
            "combined_filename": config.COMBINED_FILENAME,
            "combined_file": build_combined_workbook(auto_rows, confirmed, all_error_rows),
            "files": None,
        })
    return result
