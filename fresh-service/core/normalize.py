"""
标准化：把一行订单文字清洗成「商品名称 + 数量」，并做噪声剥离与同义词归一化。

流程（严格按主 Prompt）：
1. 行级清洗：全角转半角、中文数字转阿拉伯（仅数量上下文）、去首尾标点空白、统一括号，不做形近字纠错。
2. 数量单位抽取：正则取第一个「数字+单位」组合作为 quantity，多数量单位记录到 removed_tokens。
3. 噪声词剥离：按噪声词表替换（长度降序），记录到 removed_tokens。
4. 同义词归一化：先 exact 匹配，再 contains 匹配（alias 长度降序），loose 映射在 audit 中标记。
5. 空结果：normalized_name 为空时 status="empty"。

标准化只做确定性变换，形近字、错别字交给 RapidFuzz 兜底。
"""

from __future__ import annotations
import re
import unicodedata

# 数量单位：按长度降序排列，保证「公斤」优先于「斤」、「kg」优先于「g」
_UNITS = ["市斤", "公斤", "千克", "kg", "斤", "克", "g", "两",
          "个", "只", "条", "把", "袋", "盒", "箱", "包", "份", "颗", "根", "片"]
_UNIT_PATTERN = "|".join(sorted(_UNITS, key=len, reverse=True))
# 主 Prompt 指定的数量单位正则（阿拉伯数字 + 单位）
_QTY_RE = re.compile(rf"(\d+(?:\.\d+)?)\s*({_UNIT_PATTERN})", re.IGNORECASE)
# 中文数字 + 单位（用于「三斤」->「3斤」这类写法的定向转换）
_CN_QTY_RE = re.compile(rf"([零一二两三四五六七八九十半]+)\s*({_UNIT_PATTERN})", re.IGNORECASE)
_CN_DIGITS = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
              "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
# 统一括号分隔符：各类全角/变体括号 -> 半角 ASCII
_BRACKETS = str.maketrans({
    "（": "(", "）": ")", "【": "[", "】": "]", "〔": "[", "〕": "]",
    "［": "[", "］": "]", "｛": "{", "｝": "}", "〈": "<", "〉": ">",
})
# 首尾要去掉的标点与空白
_EDGE_CHARS = " \t\r\n，,。.、;；:：!！?？·—-—~～`'\"“”‘’()（）[]【】{}<>《》|/\\"


def cn_to_arabic(text: str) -> float | None:
    """把简单中文数字转成阿拉伯数字（支持 半/一/十二/二十 等），失败返回 None。"""
    if not text:
        return None
    if text == "半":
        return 0.5
    if text.isdigit():
        return float(text)
    if "十" in text:
        head, _, tail = text.partition("十")
        tens = _CN_DIGITS.get(head, 1) if head else 1
        ones = _CN_DIGITS.get(tail, 0) if tail else 0
        return float(tens * 10 + ones)
    if len(text) == 1 and text in _CN_DIGITS:
        return float(_CN_DIGITS[text])
    return None


def _convert_cn_quantity(line: str) -> str:
    """
    把「三斤」「十斤」「半斤」这类「中文数字+单位」定向转成阿拉伯数字。
    只作用于「中文数字后紧跟单位」的位置，避免把「三文鱼」「八角」等商品名误转。
    """

    def repl(m: re.Match) -> str:
        num = cn_to_arabic(m.group(1))
        if num is None:
            return m.group(0)
        num_str = str(int(num)) if float(num).is_integer() else str(num)
        return f"{num_str}{m.group(2)}"

    return _CN_QTY_RE.sub(repl, line)


def _clean_line(text: str) -> str:
    value = unicodedata.normalize("NFKC", text)  # 全角 -> 半角
    value = value.translate(_BRACKETS)           # 统一括号
    return value.strip(_EDGE_CHARS)


def _extract_quantity(line: str) -> tuple[str | None, str | None, float | None, str, str]:
    """抽取数量单位组合。返回 (quantity, unit, quantity_value, extra_qty, name_text)。"""
    matches = list(_QTY_RE.finditer(line))
    if not matches:
        return None, None, None, "", line
    first = matches[0]
    qty_str = first.group(1)
    unit = first.group(2)
    try:
        quantity_value = float(qty_str)
    except ValueError:
        quantity_value = None
    quantity = f"{qty_str}{unit}"  # 数量单位组合，如「5斤」
    # 名称 = 去掉所有数量单位组合后的文本
    name_text = _QTY_RE.sub("", line).strip()
    extra = "、".join(m.group(0) for m in matches[1:]) if len(matches) > 1 else ""
    return quantity, unit, quantity_value, extra, name_text


def _strip_noise(name: str, noise_df) -> tuple[str, list[str]]:
    """按噪声词表剥离修饰词（长度降序），返回 (清洗后名称, 被剥离的词)。"""
    words = [str(w).strip() for w in noise_df["noise_word"].tolist() if str(w).strip()]
    words = sorted(set(words), key=len, reverse=True)
    removed: list[str] = []
    result = name
    for w in words:
        if w and w in result:
            result = result.replace(w, "")
            removed.append(w)
    return result, removed


def _apply_synonyms(name: str, synonyms_df) -> tuple[str, str, bool]:
    """
    同义词归一化：先 exact 匹配，再 contains 匹配（alias 长度降序）。
    返回归一化后名称, synonym_applied 描述, 是否应用了 loose 映射。
    """
    if not name:
        return name, "", False
    entries: list[tuple[str, str, str, str]] = []
    for _, r in synonyms_df.iterrows():
        alias = str(r["alias"]).strip()
        canonical = str(r["canonical"]).strip()
        if not alias or not canonical:
            continue
        entries.append((
            alias, canonical,
            str(r.get("match_type", "")).strip(),
            str(r.get("confidence", "")).strip(),
        ))
    entries.sort(key=lambda e: len(e[0]), reverse=True)

    # 1) exact：整名相等（对所有条目都安全）
    for alias, canonical, _mtype, conf in entries:
        if name == alias:
            return canonical, f"{alias}→{canonical}", conf == "loose"
    # 2) contains：仅 match_type=contains 的条目作为子串替换
    for alias, canonical, mtype, conf in entries:
        if mtype == "contains" and alias in name:
            return name.replace(alias, canonical, 1), f"{alias}→{canonical}", conf == "loose"
    return name, "", False


def normalize_item(raw_line: str, synonyms_df, noise_df) -> dict:
    """
    标准化一行订单文字。输出至少包含：normalized_name, quantity, raw_line, removed_tokens, synonym_applied, status。
    """
    raw_line = str(raw_line or "")
    line = _clean_line(raw_line)
    line = _convert_cn_quantity(line)

    quantity, unit, quantity_value, extra_qty, name_text = _extract_quantity(line)
    name, removed_noise = _strip_noise(name_text, noise_df)
    name, synonym_applied, loose_applied = _apply_synonyms(name, synonyms_df)

    removed_tokens: list[str] = []
    if extra_qty:
        removed_tokens.append(f"多数量单位：{extra_qty}")
    removed_tokens.extend(removed_noise)

    name = name.strip()
    return {
        "raw_line": raw_line,
        "normalized_name": name,
        "quantity": quantity,
        "unit": unit,
        "quantity_value": quantity_value,
        "removed_tokens": removed_tokens,
        "synonym_applied": synonym_applied,
        "loose_applied": loose_applied,
        "status": "ok" if name else "empty",
    }
