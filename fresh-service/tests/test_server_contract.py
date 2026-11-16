# -*- coding: utf-8 -*-
"""工具契约单测：`fresh_order_parse` 只返回三表 JSON，不接受 `resultUrl`。

背景（2026-11-16）：产出交付（HTML 报告 + 三表 xlsx 回写）整条链路已移除，
返回值收敛为 `auto_rows` / `review_rows` / `error_rows` 及其计数。本文件守住两条不变式：

1. 入参签名里**没有** `resultUrl`——平台侧按 schema 自动注入（`async-result-url.ts`），
   声明了就一定会被注入，因此"不想要产出"必须在签名层面说清楚；
2. 返回字典的键**恰好**是六个三表字段，多一个 `filePath` / `excelFile` / `delivery_note`
   都会让界面上多出一条点不开或过期的入口。

不依赖 OCR / 真实 excel：`load_product_data_three` 与 `analyze_batch` 在用例内替换掉。
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


def test_signature_has_no_result_url():
    """产出交付已移除：工具不得再声明 `resultUrl`（否则平台会注入、服务会忽略）。"""
    from mcp_server import fresh_order_parse

    assert "resultUrl" not in inspect.signature(fresh_order_parse).parameters


def test_returns_only_three_tables(monkeypatch):
    """返回值只含三表与计数，且计数与行数一致。"""
    import mcp_server

    auto = [{"raw_line": "洋芋2斤", "matched_name": "土豆", "sku_id": "VEG-002", "score": 100.0}]
    review = [{"raw_line": "蕃茄3斤", "top_score": 60.0, "candidates": []}]
    error = [{"raw_line": "", "error_type": "OCR_EMPTY", "message": "识别为空"}]

    monkeypatch.setattr(mcp_server, "load_product_data_three", lambda *a, **k: object())
    monkeypatch.setattr(mcp_server, "analyze_batch", lambda orders, data: (auto, review, error))

    result = mcp_server.fresh_order_parse(
        image_path="http://example.test/order1.png",
        sku_path="http://example.test/sku.xlsx",
    )

    assert set(result) == _TRIPLE_KEYS
    assert result["auto_rows"] == auto and result["auto_count"] == 1
    assert result["review_rows"] == review and result["review_count"] == 1
    assert result["error_rows"] == error and result["error_count"] == 1


@pytest.mark.parametrize("param", ["image_path", "sku_path"])
def test_relative_path_rejected(param):
    """平台漏配 `file_args` 时应噪声化失败，而不是拿相对路径去下载。"""
    from mcp_server import fresh_order_parse

    kwargs = {"image_path": "http://example.test/a.png", "sku_path": "http://example.test/s.xlsx"}
    kwargs[param] = "临时空间/订单1.png"

    with pytest.raises(ValueError, match="http/https"):
        fresh_order_parse(**kwargs)
