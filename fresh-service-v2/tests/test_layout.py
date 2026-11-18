# -*- coding: utf-8 -*-
"""版面归一层与三表分流：纯函数，不依赖 paddleocr / 网络 / 真实图片。

覆盖 v2 相对 v1 的最大新增面积（`core/layout.py` + `pipeline.analyze_document`）：

- 表格单：按表头定列角色，一个商品跨多个单元格也还原成"一行一商品"；
- 手写列表单：数量取「数字 + 数量单位」锚点，品名与单位分得开；
- 版面置信度不足（缺数量/单位、识别不稳）→ **即使匹配到高分也进候选审核**，不自动放行；
- 版面识别不出商品名的行 → `LAYOUT_UNPARSED` 进异常表，不静默消失。
"""
import pandas as pd
import pytest

from core.layout import build_records
from core.pipeline import analyze_document


def box(text: str, x: float, y: float, w: float = 60, h: float = 20) -> dict:
    """一个 OCR 文本框（与 `core.ocr.ocr_boxes` 的字段一致）。"""
    return {"text": text, "x0": x, "y0": y, "x1": x + w, "y1": y + h,
            "cx": x + w / 2, "cy": y + h / 2}


def data() -> dict:
    """最小商品库：只有「土豆」一个启用 SKU，匹配结果可预期。"""
    sku = pd.DataFrame([{
        "编码": "1", "商品名称": "土豆", "别名": "", "品类": "蔬菜",
        "规格": "", "单位": "斤", "是否启用": "是",
    }])
    synonyms = pd.DataFrame(columns=["alias", "canonical", "match_type",
                                     "confidence", "source", "version", "note"])
    noise = pd.DataFrame(columns=["noise_word", "category", "version"])
    return {"sku": sku, "synonyms": synonyms, "noise": noise}


def record(name="土豆", qty="2", unit="斤", conf=1.0, raw="") -> dict:
    return {"name": name, "spec": "", "qty": qty, "unit": unit, "remark": "",
            "conf": conf, "raw": raw or f"{name}{qty}{unit}"}


# ---------------------------------------------------------------- 版面还原

def test_table_layout_splits_cells_into_rows():
    """表格截图：表头 + 每商品 3 个单元格 → 2 条记录，名称/数量/单位各归其位。"""
    boxes = [
        box("商品名称", 50, 0, 90), box("数量", 300, 0, 40), box("单位", 400, 0, 40),
        box("土豆", 50, 40), box("2", 300, 40), box("斤", 400, 40),
        box("番茄", 50, 80), box("1", 300, 80), box("包", 400, 80),
    ]

    doc = build_records(boxes)

    assert doc.kind == "table"
    assert [(r["name"], r["qty"], r["unit"]) for r in doc.records] == [
        ("土豆", "2", "斤"), ("番茄", "1", "包"),
    ]
    assert doc.dropped == []


def test_list_layout_anchors_quantity_and_unit():
    """手写列表：品名与数量单位连写，也要拆成 name / qty / unit 三件。"""
    doc = build_records([box("土豆2斤", 50, 0, 80), box("番茄3包", 50, 40, 80)])

    assert doc.kind == "list"
    assert [(r["name"], r["qty"], r["unit"]) for r in doc.records] == [
        ("土豆", "2", "斤"), ("番茄", "3", "包"),
    ]


def test_header_and_junk_rows_are_dropped():
    """表头/合计这类噪声行只能进 dropped，不能变成商品行污染三表。"""
    doc = build_records([box("土豆2斤", 50, 0, 80), box("合计：2件", 50, 40, 120)])

    assert [r["name"] for r in doc.records] == ["土豆"]
    assert doc.dropped, "合计行应被记录进 dropped"


# ---------------------------------------------------------------- 三表分流

def test_high_confidence_auto_passes():
    auto, review, error = analyze_document([record(conf=1.0)], data())

    assert len(auto) == 1 and not review and not error
    assert auto[0]["matched_name"] == "土豆" and auto[0]["sku_id"] == "1"
    assert auto[0]["quantity"] == "2斤"


def test_low_layout_confidence_downgrades_to_review():
    """版面置信度不足时，匹配到 100 分也不自动放行 —— 转人工确认。"""
    auto, review, error = analyze_document([record(conf=0.20)], data())

    assert not auto and not error
    assert len(review) == 1
    assert review[0]["layout_confidence"] == pytest.approx(0.20)
    assert review[0]["top_score"] == pytest.approx(100.0)
    assert review[0]["candidates"][0]["name"] == "土豆"


def test_missing_quantity_also_downgrades():
    """数量与单位都缺 → 版面不确定，同样不许自动放行（哪怕置信度很高）。"""
    auto, review, _error = analyze_document([record(qty="", unit="", conf=1.0)], data())

    assert not auto and len(review) == 1


def test_unparsed_rows_become_error_rows():
    """版面层识别到内容却没解析出商品名时，必须以 LAYOUT_UNPARSED 留下痕迹。"""
    _auto, _review, error = analyze_document([], data(), source="order1.png",
                                             unparsed=[{"raw": "手写涂改行", "reason": "无可识别商品名"}])

    assert len(error) == 1
    assert error[0]["error_type"] == "LAYOUT_UNPARSED"
    assert error[0]["raw_line"] == "手写涂改行"
    assert error[0]["source"] == "order1.png"


def test_rows_carry_order_no_and_source():
    """三表每行都要带 order_no / source（多单合并时靠它们区分来源）。"""
    auto, _review, _error = analyze_document([record()], data(), order_no=3, source="order3.png")

    assert auto[0]["order_no"] == 3 and auto[0]["source"] == "order3.png"
