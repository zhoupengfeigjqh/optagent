# -*- coding: utf-8 -*-
"""工具契约单测：`fresh_order_parse` 只返回三表 JSON，且不声明 `resultUrl`。

背景（2026-11-18）：产出交付（HTML 报告 + 三表 xlsx 回写）已**屏蔽**（实现保留，
见 `mcp_server.OUTPUT_DELIVERY_ENABLED`）。本文件守住三条不变式：

1. 签名里**没有** `resultUrl`——平台的注入判据是"工具自己的 inputSchema 里声明了该参数"
   （`agent-backend/src/infra/mcp/async-result-url.ts`），所以"不要产出"必须在签名层面说清楚；
2. 返回字典的键**恰好**是六个三表字段，多一个 `filePath` / `excelFile` / `delivery_note`
   都会让界面上多出一条点不开或过期的入口；
3. 相对路径仍被拒收（平台漏配 `file_args` 时应当噪声化失败，而不是拿相对路径去下载）。

不依赖 OCR / 网络：`load_product_data_three` 与 `_analyze_image` 在用例内替换掉。
"""
import importlib.util
import inspect

import pytest

_REQUIRED = ("fastmcp", "pandas", "rapidfuzz")
pytestmark = pytest.mark.skipif(
    any(importlib.util.find_spec(name) is None for name in _REQUIRED),
    reason="未安装运行期依赖（fastmcp / pandas / rapidfuzz），跳过契约测试",
)

_TRIPLE_KEYS = {
    "auto_rows",
    "auto_count",
    "review_rows",
    "review_count",
    "error_rows",
    "error_count",
}

#: 改造后对外暴露的完整入参集合（多一个等于多一个平台会注入/模型会填的口子）
_EXPECTED_PARAMS = ["image_path", "sku_path", "noise_path", "synonyms_path", "layout"]


def _stub(monkeypatch):
    """把"读三张表"和"识别图片"两处外部依赖换掉，只留纯出参装配。"""
    import mcp_server

    auto = [{"raw_line": "洋芋2斤", "matched_name": "土豆", "sku_id": "1", "score": 100.0}]
    review = [{"raw_line": "蕃茄3斤", "top_score": 60.0, "candidates": []}]
    error = [{"raw_line": "", "error_type": "OCR_EMPTY", "message": "识别为空"}]
    monkeypatch.setattr(mcp_server, "load_product_data_three", lambda *a, **k: object())
    monkeypatch.setattr(
        mcp_server, "_analyze_image", lambda *a, **k: (list(auto), list(review), list(error))
    )
    return auto, review, error


def test_signature_has_no_result_url():
    """产出交付已屏蔽：工具不得再声明 `resultUrl`（声明了平台就会注入）。"""
    from mcp_server import fresh_order_parse

    params = list(inspect.signature(fresh_order_parse).parameters)
    assert "resultUrl" not in params
    assert params == _EXPECTED_PARAMS


def test_returns_only_three_tables(monkeypatch):
    """返回值只含三表与计数，且计数与行数一致。"""
    import mcp_server

    auto, review, error = _stub(monkeypatch)

    result = mcp_server.fresh_order_parse(
        image_path="http://example.test/order1.png",
        sku_path="http://example.test/sku.xlsx",
    )

    assert set(result) == _TRIPLE_KEYS
    assert result["auto_rows"] == auto and result["auto_count"] == 1
    assert result["review_rows"] == review and result["review_count"] == 1
    assert result["error_rows"] == error and result["error_count"] == 1


@pytest.mark.parametrize("param", ["image_path", "sku_path"])
def test_relative_path_rejected(param, monkeypatch):
    """平台漏配 `file_args` 时应噪声化失败，而不是拿相对路径去下载。"""
    import mcp_server

    _stub(monkeypatch)
    kwargs = {"image_path": "http://example.test/a.png", "sku_path": "http://example.test/s.xlsx"}
    kwargs[param] = "临时空间/订单1.png"

    with pytest.raises(ValueError, match="http/https"):
        mcp_server.fresh_order_parse(**kwargs)
