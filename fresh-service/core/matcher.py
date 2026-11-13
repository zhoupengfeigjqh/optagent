"""
商品模糊匹配与三档分流（基于 RapidFuzz，scorer=fuzz.WRatio）。

分流规则（按「行」）：
- score >= T_HIGH                 -> auto（自动通过）
- T_LOW <= score < T_HIGH         -> review（候选审核，附 TopN candidates）
- score < T_LOW 或 extractOne=None -> error（NO_SKU_MATCH / LOW_CONFIDENCE_NO_CANDIDATE）

只匹配「是否启用 = 是」的 SKU。
"""

from __future__ import annotations
from rapidfuzz import fuzz, process
from . import config

def enabled_choices(df_sku) -> tuple[list[str], list[tuple[str, str]]]:
    """
    返回可匹配字符串列表与对应 (sku_id, canonical_name) 元信息。
    每个启用 SKU 生成「商品名称 + 别名」若干个检索键。
    """
    choices: list[str] = []
    meta: list[tuple[str, str]] = []
    for _, r in df_sku.iterrows():
        enabled = str(r.get("是否启用", "")).strip()
        if enabled != "是":
            continue
        canonical = str(r["商品名称"]).strip()
        sku_id = str(r["SKU编码"]).strip()
        names = [canonical]
        alias_cell = str(r.get("别名") or "").strip()
        if alias_cell and alias_cell != "nan":
            for a in alias_cell.split("|"):
                a = a.strip()
                if a and a not in names:
                    names.append(a)
        for n in names:
            if n:
                choices.append(n)
                meta.append((sku_id, canonical))
    return choices, meta


def _dedupe_candidates(results, meta, limit: int) -> list[dict]:
    """按 sku_id 去重（保留最高分），按分数降序取前 limit 个。"""
    best: dict[str, dict] = {}
    for _choice, score, idx in results:
        sku_id, canonical = meta[idx]
        if sku_id not in best or score > best[sku_id]["score"]:
            best[sku_id] = {"name": canonical, "score": score, "sku_id": sku_id}
    return sorted(best.values(), key=lambda c: (-c["score"], c["sku_id"]))[:limit]


def match_name(normalized_name: str, df_sku) -> dict:
    """
    对单个标准化名称做匹配与分流。
    返回 dict：
      result=auto   -> matched_name, sku_id, score
      result=review -> top_score, candidates[{name, score, sku_id}]
      result=error  -> error_type(NO_SKU_MATCH/LOW_CONFIDENCE_NO_CANDIDATE), top_candidate, top_score
    """
    q = (normalized_name or "").strip()
    choices, meta = enabled_choices(df_sku)
    if not choices:
        return {"result": "error", "error_type": "NO_SKU_MATCH",
                "top_candidate": None, "top_score": None}

    # extractOne 取最高分用于分流（先按 T_LOW 截断）
    best = process.extractOne(q, choices, scorer=fuzz.WRatio, score_cutoff=config.T_LOW)
    if best is None:
        # 无 >= T_LOW 的匹配，仍返回 Top-N 非零候选，避免漏掉形近/低分但相关的商品，例如「士豆」虽低于阈值，但候选里应保留「土豆」供人工判断
        results = process.extract(q, choices, scorer=fuzz.WRatio, limit=None)
        nonzero = [(c, s, i) for c, s, i in results if s > 0]
        candidates = _dedupe_candidates(nonzero, meta, config.TOP_N)
        any_best = process.extractOne(q, choices, scorer=fuzz.WRatio)
        if any_best is None or any_best[1] <= 0:
            return {"result": "error", "error_type": "NO_SKU_MATCH",
                    "top_candidate": None, "top_score": 0.0, "candidates": candidates}
        _sku_id, canonical = meta[any_best[2]]
        return {"result": "error", "error_type": "LOW_CONFIDENCE_NO_CANDIDATE",
                "top_candidate": canonical, "top_score": any_best[1], "candidates": candidates}

    best_score = float(best[1])
    if best_score >= config.T_HIGH:
        sku_id, canonical = meta[best[2]]
        return {"result": "auto", "matched_name": canonical,
                "sku_id": sku_id, "score": best_score}

    # review：extract 取 TopN 候选
    results = process.extract(q, choices, scorer=fuzz.WRatio,
                              score_cutoff=config.T_LOW, limit=None)
    candidates = _dedupe_candidates(results, meta, config.TOP_N)
    return {"result": "review", "top_score": best_score, "candidates": candidates}
