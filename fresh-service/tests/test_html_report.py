# -*- coding: utf-8 -*-
"""解析报告（``core/html_report.py``）单测：转义、上限、推荐标记、无脚本。

这一层是纯函数，不依赖 pandas / fastmcp，任何环境都能跑。

依据（``bom-service/report.py`` 的三条硬约束 + 宪章原则四/九）：
- 页面在平台是 ``sandbox=""`` + ``CSP: sandbox`` 打开的 ⇒ MUST NOT 有 ``<script>``；
- MUST NOT 引用外部资源（内网/离线）；
- 订单文本一律转义（报告本身还是可下载的文件）；
- 超限整行不渲染，缺口在末尾统一交代。
"""
def report_module():
    from core import html_report
    return html_report


def _auto_row(**over):
    row = {
        "raw_line": "洋芋2斤", "normalized_name": "土豆", "quantity": "2斤", "unit": "斤",
        "removed_tokens": [], "synonym_applied": "洋芋→土豆", "loose_applied": False,
        "matched_name": "土豆", "sku_id": "VEG-002", "score": 100.0,
        "order_no": 1, "source": "order1.png",
    }
    row.update(over)
    return row


def _review_row(**over):
    row = {
        "raw_line": "蕃茄3斤", "normalized_name": "蕃茄", "quantity": "3斤", "unit": "斤",
        "index": 0, "top_score": 60.0,
        "candidates": [
            {"name": "小番茄", "score": 60.0, "sku_id": "FRU-021"},
            {"name": "番茄", "score": 50.0, "sku_id": "VEG-001"},
        ],
        "order_no": 1, "source": "order1.png",
    }
    row.update(over)
    return row


def _error_row(**over):
    row = {
        "raw_line": "士豆", "normalized_name": "士豆", "quantity": "1斤", "unit": "斤",
        "error_type": "NO_SKU_MATCH", "top_candidate": None, "top_score": None,
        "candidates": [], "message": "未匹配到任何启用商品",
        "order_no": 1, "source": "order1.png",
    }
    row.update(over)
    return row


def render(auto=None, review=None, error=None, **kwargs):
    mod = report_module()
    return mod.build_report(
        [_auto_row()] if auto is None else auto,
        [_review_row()] if review is None else review,
        [_error_row()] if error is None else error,
        source="order1.png",
        workbook_name="生鲜订单_order1_20261113_153012.xlsx",
        generated_at="2026-11-13 15:30",
        **kwargs,
    ).decode("utf-8")


# ---------------------------------------------------------------- 文件名

def test_report_filename_shares_workbook_stem():
    mod = report_module()
    base = "生鲜订单_order1_20261113_153012"
    assert mod.report_filename(base) == f"{base}_报告.html"


# ---------------------------------------------------------------- 安全

def test_order_text_is_escaped():
    """订单原文里的标签必须被转义——报告本身是可下载文件，撕开版面就是注入面。"""
    doc = render(auto=[_auto_row(raw_line="<script>alert('x')</script>土豆2斤")])
    assert "<script>alert" not in doc
    assert "&lt;script&gt;" in doc


def test_report_has_no_script_and_no_external_resource():
    doc = render()
    assert "<script" not in doc.lower()
    assert "http://" not in doc and "https://" not in doc
    assert "src=" not in doc and "href=" not in doc
    assert "@import" not in doc


def test_report_states_export_happens_outside_the_page():
    """沙箱里没有下载：页面只写文件名 + 指路，不能承诺"点这里导出"。"""
    doc = render()
    assert "生鲜订单_order1_20261113_153012.xlsx" in doc
    assert "入口行" in doc and "后台记录" in doc


# ---------------------------------------------------------------- 三档内容

def test_recommended_candidate_is_marked_in_text():
    """推荐项既加粗又有「推荐」文字标签（不靠颜色单独传达，原则四）。"""
    doc = render()
    assert "<b>小番茄</b>" in doc
    assert "推荐" in doc
    assert '<span class="cand">番茄' in doc  # 非推荐项照常列出，但不加粗、不带推荐标签


def test_error_type_has_chinese_label_and_raw_code():
    doc = render()
    assert "无任何可用候选" in doc
    assert "NO_SKU_MATCH" in doc


def test_unknown_error_type_falls_back_to_other():
    doc = render(error=[_error_row(error_type="SOMETHING_NEW")])
    assert "其他异常" in doc
    assert "SOMETHING_NEW" in doc


def test_empty_tables_show_hint_not_crash():
    doc = render(auto=[], review=[], error=[])
    assert "没有高度匹配行" in doc
    assert "没有待人工确认的行" in doc
    assert "没有异常记录" in doc
    assert "全部 0 行均已高度匹配" in doc


def test_conclusion_flags_pending_and_errors():
    doc = render()
    assert "1 行需人工确认" in doc and "1 行异常" in doc
    assert "concl concl--bad" in doc


def test_counts_and_totals_rendered():
    doc = render()
    assert ">高度匹配<" in doc and ">候选审核<" in doc and ">异常记录<" in doc


# ---------------------------------------------------------------- 上限

def test_rows_are_truncated_with_note(monkeypatch):
    mod = report_module()
    monkeypatch.setattr(mod, "MAX_REPORT_ROWS", 2)
    rows = [_auto_row(raw_line=f"土豆{i}斤") for i in range(5)]
    doc = render(auto=rows)
    assert "土豆4斤" not in doc
    assert "共 5 行，报告内展示前 2 行" in doc
    assert "「高度匹配」表" in doc


def test_non_mapping_rows_are_skipped():
    """脏行不该让整页打不开，也不该被算进"共 N 行"的展示口径之外。"""
    doc = render(auto=[_auto_row(), "not-a-row", None])
    assert "土豆" in doc


def test_missing_fields_do_not_crash():
    doc = render(auto=[{"raw_line": "只有原始行"}])
    assert "只有原始行" in doc
