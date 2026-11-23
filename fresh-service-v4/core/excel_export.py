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


# ---------------------------------------------------------------- 最终交付版式
# 与「识别结果示例.xlsx」一致：
#   高度匹配 / 异常记录：商品名称 = SKU 标准名
#   候选审核：候选1~候选5 就是纯商品名（不带分数），「商品名称」用下拉列表直接引用这 5 列
OUTPUT_BASE_COLUMNS = ["客户", "商品名称", "销售单位", "数量", "单价", "金额", "供应商"]
OUTPUT_AUTO_COLUMNS = OUTPUT_BASE_COLUMNS + ["原始记录"]
OUTPUT_REVIEW_COLUMNS = OUTPUT_BASE_COLUMNS + ["候选1", "候选2", "候选3", "候选4", "候选5", "原始记录"]
OUTPUT_ERROR_COLUMNS = OUTPUT_BASE_COLUMNS + ["原始记录", "异常说明"]
CANDIDATE_LIMIT = 5
#: 候选列在「候选审核」表里的起止列（H~L），同时也是下拉的数据源
CANDIDATE_FIRST_COL = len(OUTPUT_BASE_COLUMNS) + 1
CANDIDATE_LAST_COL = CANDIDATE_FIRST_COL + CANDIDATE_LIMIT - 1

#: 「最终推荐」表按来源分色：高度匹配黑（常规）、候选审核紫加粗、异常记录红加粗
FINAL_AUTO_COLOR = "FF000000"
FINAL_REVIEW_COLOR = "FF7030A0"
FINAL_ERROR_COLOR = "FFFF0000"


def _text(value) -> str:
    return "" if value is None else str(value)


def _qty_cell(row):
    """数量列只放数字（“1件” -> 1）；销售单位单独一列。"""
    qty = _text(row.get("quantity")).strip()
    unit = _text(row.get("unit")).strip()
    if unit and qty.endswith(unit):
        qty = qty[: -len(unit)].strip()
    try:
        number = float(qty)
    except (TypeError, ValueError):
        return qty
    return int(number) if number.is_integer() else number


def build_output_workbook(auto_rows, review_rows, error_rows) -> bytes:
    """最终交付工作簿：**只显示一张「最终推荐」**，明细三表隐藏在其后。

    - 最终推荐：三档按 高度匹配 → 候选审核 → 异常记录 顺序拼接，列与「高度匹配」一致
      （客户 / 商品名称 / 销售单位 / 数量 / 单价 / 金额 / 供应商 / 原始记录）；
      高度匹配黑字、候选审核紫字加粗、异常记录红字加粗；
      候选审核那几行的「商品名称」保留下拉，数据源是「候选审核」表同一行的 候选1~候选5；
    - 高度匹配 / 候选审核 / 异常记录：`sheet_state = hidden`，供核对与下拉取值，默认看不到；
    - 「客户」列留空（只保留表头）：单图解析没有客户信息，也不写「订单001」这种占位值；
    - 高度匹配、异常记录：商品名称就是 SKU 标准名（异常行取最高候选的标准名）；
    - 三张明细表都带「原始记录」列；
    - 销售单位 / 数量 / 原始记录 / 异常说明 保留原值；单价 / 金额 / 供应商只留列名。
    """
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.datavalidation import DataValidation

    header_font = Font(bold=True)
    wrap = Alignment(vertical="top", wrap_text=False)

    def fill_header(ws, columns):
        ws.append(columns)
        for cell in ws[1]:
            cell.font = header_font
        ws.freeze_panes = "A2"

    wb = Workbook()

    # ---- 高度匹配 ----
    ws_auto = wb.active
    ws_auto.title = config.SHEET_AUTO
    fill_header(ws_auto, OUTPUT_AUTO_COLUMNS)
    for row in auto_rows:
        ws_auto.append([
            "", _text(row.get("matched_name")), _text(row.get("unit")),
            _qty_cell(row), "", "", "",
            _text(row.get("raw_line")),                        # 原始记录
        ])

    # ---- 候选审核（商品名称 = 下拉，数据源就是候选1~候选5） ----
    ws_review = wb.create_sheet(config.SHEET_REVIEW)
    fill_header(ws_review, OUTPUT_REVIEW_COLUMNS)
    for idx, row in enumerate(review_rows, start=2):
        candidates = list(row.get("candidates") or [])[:CANDIDATE_LIMIT]
        names = [_text(c.get("name")) for c in candidates]
        ws_review.cell(idx, 1, "")                            # 客户留空（单图无客户信息）
        ws_review.cell(idx, 2, names[0] if names else "")     # 默认取第一候选，可下拉改
        ws_review.cell(idx, 3, _text(row.get("unit")))
        ws_review.cell(idx, 4, _qty_cell(row))
        for col in range(5, CANDIDATE_FIRST_COL):             # 单价/金额/供应商 留空
            ws_review.cell(idx, col, "")
        for i in range(CANDIDATE_LIMIT):
            ws_review.cell(idx, CANDIDATE_FIRST_COL + i, names[i] if i < len(names) else "")
        ws_review.cell(idx, CANDIDATE_FIRST_COL + CANDIDATE_LIMIT,
                       _text(row.get("raw_line")))            # 原始记录
        if names:                                             # 每行一个下拉，引用本行候选
            dv = DataValidation(
                type="list",
                formula1=f"${get_column_letter(CANDIDATE_FIRST_COL)}{idx}"
                         f":${get_column_letter(CANDIDATE_LAST_COL)}{idx}",
                allow_blank=True,
                showDropDown=False,                          # OOXML 里 False 才显示箭头
            )
            dv.error = "请从本行的候选里选择"
            dv.errorTitle = "只能选候选商品"
            dv.showErrorMessage = False                      # 允许手填：下拉是省事，不强制
            ws_review.add_data_validation(dv)
            dv.add(ws_review.cell(idx, 2).coordinate)

    # ---- 异常记录 ----
    ws_error = wb.create_sheet(config.SHEET_ERROR)
    fill_header(ws_error, OUTPUT_ERROR_COLUMNS)
    for row in error_rows:
        ws_error.append([
            "", _text(row.get("top_candidate")), _text(row.get("unit")),
            _qty_cell(row), "", "", "",
            _text(row.get("raw_line")), _text(row.get("message")),
        ])

    # ---- 最终推荐（三表按 高度匹配 → 候选审核 → 异常记录 顺序拼接；唯一可见） ----
    ws_final = wb.create_sheet(config.SHEET_FINAL)
    fill_header(ws_final, OUTPUT_AUTO_COLUMNS)
    font_auto = Font(color=FINAL_AUTO_COLOR)
    font_review = Font(color=FINAL_REVIEW_COLOR, bold=True)
    font_error = Font(color=FINAL_ERROR_COLOR, bold=True)

    def append_final(values: list, font) -> int:
        """写一行并整行套用来源字体，返回该行行号（1 基）。"""
        row_idx = ws_final.max_row + 1
        for col, value in enumerate(values, start=1):
            cell = ws_final.cell(row_idx, col, value)
            cell.font = font
        return row_idx

    for row in auto_rows:
        append_final([
            "", _text(row.get("matched_name")), _text(row.get("unit")),
            _qty_cell(row), "", "", "",
            _text(row.get("raw_line")),
        ], font_auto)

    for idx, row in enumerate(review_rows, start=2):
        candidates = list(row.get("candidates") or [])[:CANDIDATE_LIMIT]
        names = [_text(c.get("name")) for c in candidates]
        final_idx = append_final([
            "", names[0] if names else "", _text(row.get("unit")),
            _qty_cell(row), "", "", "",
            _text(row.get("raw_line")),
        ], font_review)
        if names:                                  # 下拉数据源：候选审核表同一行的候选1~候选5
            dv = DataValidation(
                type="list",
                formula1=(f"'{config.SHEET_REVIEW}'!"
                          f"${get_column_letter(CANDIDATE_FIRST_COL)}{idx}"
                          f":${get_column_letter(CANDIDATE_LAST_COL)}{idx}"),
                allow_blank=True,
                showDropDown=False,
            )
            dv.error = "请从候选审核表的本行候选里选择"
            dv.errorTitle = "只能选候选商品"
            dv.showErrorMessage = False            # 允许手填：下拉是省事，不强制
            ws_final.add_data_validation(dv)
            dv.add(ws_final.cell(final_idx, 2).coordinate)

    for row in error_rows:
        append_final([
            "", _text(row.get("top_candidate")), _text(row.get("unit")),
            _qty_cell(row), "", "", "",
            _text(row.get("raw_line")),
        ], font_error)

    # ---- 列宽（不影响内容，纯粹好看） ----
    widths = {"A": 12, "B": 26, "C": 10, "D": 8, "E": 10, "F": 10, "G": 22,
              "H": 22, "I": 22, "J": 22, "K": 22, "L": 22, "M": 22}
    for ws in (ws_auto, ws_review, ws_error, ws_final):
        for letter, width in widths.items():
            ws.column_dimensions[letter].width = width
        for row in ws.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = wrap

    # ---- 只展示「最终推荐」：其余三张隐藏，并把拼接表放到第一个标签位 ----
    for ws in (ws_auto, ws_review, ws_error):
        ws.sheet_state = "hidden"
    wb.move_sheet(ws_final, offset=-(len(wb.sheetnames) - 1))
    wb.active = 0

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
