"""
Excel 导出：三张工作表（高度匹配、审核通过、异常记录）。
- 默认导出为单个工作簿，三个工作表
- split_files 时导出三个独立 xlsx
"""

from __future__ import annotations
import io
import pandas as pd
from . import config

# 三张表的列（中文表头）——批量时用「订单编号」区分每个订单，「来源」放最后一列
_AUTO_COLUMNS = ["订单编号", "原始行", "标准化名称", "数量", "匹配商品", "SKU编码", "置信度", "来源"]
_APPROVED_COLUMNS = ["订单编号", "原始行", "标准化名称", "数量", "审核商品", "SKU编码", "置信度", "审核标记", "来源"]
_ERROR_COLUMNS = ["订单编号", "原始行", "标准化名称", "数量", "异常类型", "最高候选", "最高分", "候选列表", "说明", "来源"]


def _fmt_score(score) -> float | str:
    if score is None:
        return ""
    try:
        return round(float(score), 2)
    except (TypeError, ValueError):
        return ""


def _auto_df(auto_rows) -> pd.DataFrame:
    return pd.DataFrame([{
        "订单编号": r.get("order_no", ""),
        "原始行": r.get("raw_line", ""),
        "标准化名称": r.get("normalized_name", ""),
        "数量": r.get("quantity") or "",
        "匹配商品": r.get("matched_name", ""),
        "SKU编码": r.get("sku_id", ""),
        "置信度": _fmt_score(r.get("score")),
        "来源": r.get("source", ""),
    } for r in auto_rows], columns=_AUTO_COLUMNS)


def _approved_df(approved_rows) -> pd.DataFrame:
    return pd.DataFrame([{
        "订单编号": r.get("order_no", ""),
        "原始行": r.get("raw_line", ""),
        "标准化名称": r.get("normalized_name", ""),
        "数量": r.get("quantity") or "",
        "审核商品": r.get("matched_name", ""),
        "SKU编码": r.get("sku_id", ""),
        "置信度": _fmt_score(r.get("score")),
        "审核标记": r.get("audit_note", "") or "",
        "来源": r.get("source", ""),
    } for r in approved_rows], columns=_APPROVED_COLUMNS)


def _fmt_candidates(candidates) -> str:
    if not candidates:
        return ""
    return " / ".join(f"{c['name']}({c['score']:.0f})" for c in candidates)


def _error_df(error_rows) -> pd.DataFrame:
    return pd.DataFrame([{
        "订单编号": r.get("order_no", ""),
        "原始行": r.get("raw_line", ""),
        "标准化名称": r.get("normalized_name", ""),
        "数量": r.get("quantity") or "",
        "异常类型": r.get("error_type", ""),
        "最高候选": r.get("top_candidate") or "",
        "最高分": _fmt_score(r.get("top_score")),
        "候选列表": _fmt_candidates(r.get("candidates")),
        "说明": r.get("message", "") or "",
        "来源": r.get("source", ""),
    } for r in error_rows], columns=_ERROR_COLUMNS)


def _write_sheets(writer, auto_rows, approved_rows, error_rows) -> None:
    _auto_df(auto_rows).to_excel(writer, sheet_name=config.SHEET_AUTO, index=False)
    _approved_df(approved_rows).to_excel(writer, sheet_name=config.SHEET_APPROVED, index=False)
    _error_df(error_rows).to_excel(writer, sheet_name=config.SHEET_ERROR, index=False)


def build_review_workbook(auto_rows, review_rows, error_rows) -> bytes:
    """单工作簿三表（高度匹配 / 候选审核 / 异常记录）的字节内容。

    fresh_order_parse 专用：解析工具没有人工审核环节，``review_rows`` 直接进
    「候选审核」表，因此不能复用 ``build_combined_workbook``（那张表的第三列是
    「审核通过」，需要 decisions 合成后的 confirmed 行）。
    一次调用只回写**一个**文件，界面上也就只有一条下载入口。
    """
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        _auto_df(auto_rows).to_excel(writer, sheet_name=config.SHEET_AUTO, index=False)
        _review_df(review_rows).to_excel(writer, sheet_name=config.SHEET_REVIEW, index=False)
        _error_df(error_rows).to_excel(writer, sheet_name=config.SHEET_ERROR, index=False)
    return buf.getvalue()


def build_combined_workbook(auto_rows, approved_rows, error_rows) -> bytes:
    """生成单工作簿（三工作表）的字节内容。"""
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        _write_sheets(writer, auto_rows, approved_rows, error_rows)
    return buf.getvalue()


def build_split_files(auto_rows, approved_rows, error_rows) -> list[dict]:
    """生成三个独立 xlsx，返回 [{"filename": str, "file": bytes}, ...]。"""
    parts = [
        (config.FILE_AUTO, config.SHEET_AUTO, _auto_df(auto_rows)),
        (config.FILE_APPROVED, config.SHEET_APPROVED, _approved_df(approved_rows)),
        (config.FILE_ERROR, config.SHEET_ERROR, _error_df(error_rows)),
    ]
    files = []
    for filename, sheet_name, df in parts:
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name=sheet_name, index=False)
        files.append({"filename": filename, "file": buf.getvalue()})
    return files


# 候选审核（未人工审核的 review 行）的列
_REVIEW_COLUMNS = ["订单编号", "原始行", "标准化名称", "数量", "最高分", "候选列表", "来源"]


def _review_df(review_rows) -> pd.DataFrame:
    return pd.DataFrame([{
        "订单编号": r.get("order_no", ""),
        "原始行": r.get("raw_line", ""),
        "标准化名称": r.get("normalized_name", ""),
        "数量": r.get("quantity") or "",
        "最高分": _fmt_score(r.get("top_score")),
        "候选列表": _fmt_candidates(r.get("candidates")),
        "来源": r.get("source", ""),
    } for r in review_rows], columns=_REVIEW_COLUMNS)


def build_review_split_files(auto_rows, review_rows, error_rows) -> list[dict]:
    """生成三个独立 xlsx（高度匹配/候选审核/异常记录），返回 [{"filename","file"}, ...]。

    fresh_order_parse 单工具使用：没有人工审核，review_rows 直接进「候选审核」表。
    """
    parts = [
        (config.FILE_AUTO, config.SHEET_AUTO, _auto_df(auto_rows)),
        (config.FILE_REVIEW, config.SHEET_REVIEW, _review_df(review_rows)),
        (config.FILE_ERROR, config.SHEET_ERROR, _error_df(error_rows)),
    ]
    files = []
    for filename, sheet_name, df in parts:
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name=sheet_name, index=False)
        files.append({"filename": filename, "file": buf.getvalue()})
    return files
