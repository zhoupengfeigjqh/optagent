# -*- coding: utf-8 -*-
"""屏蔽证明：交付闸门关着时，既不生成产物、也不发 POST。

为什么单独一组：`OUTPUT_DELIVERY_ENABLED` 是"回写会不会悄悄复活"的唯一防线，读代码不算验证。
这里把 **HTTP 回写、报告渲染、工作簿生成** 三处都换成记录器，断言调用次数为 0 ——
只要哪天有人把闸门打开或把 `_maybe_deliver` 挪回主流程，本文件立刻变红。

同时钉住"恢复三步"的前两步是配套的：签名里没有 `resultUrl`（见 `test_server_contract.py`）
⇒ 平台不注入；常量 `False` ⇒ 即使有人绕过签名直接调用 `_maybe_deliver` 也不会交付。
"""
import importlib.util

import httpx
import pytest

_REQUIRED = ("fastmcp", "pandas", "rapidfuzz")
pytestmark = pytest.mark.skipif(
    any(importlib.util.find_spec(name) is None for name in _REQUIRED),
    reason="未安装运行期依赖（fastmcp / pandas / rapidfuzz），跳过屏蔽测试",
)

_TRIPLE_KEYS = {
    "auto_rows",
    "auto_count",
    "review_rows",
    "review_count",
    "error_rows",
    "error_count",
}


def test_delivery_switch_is_off():
    """开关本身也要钉住：打开它就是"恢复交付"，必须是有意识的改动。"""
    import mcp_server

    assert mcp_server.OUTPUT_DELIVERY_ENABLED is False


def test_no_generation_no_post(monkeypatch):
    """一次完整解析：产物没生成、POST 没发生、返回值仍是六键。"""
    import mcp_server

    calls: list[str] = []
    monkeypatch.setattr(mcp_server, "load_product_data_three", lambda *a, **k: object())
    monkeypatch.setattr(mcp_server, "_analyze_image", lambda *a, **k: ([{"raw_line": "洋芋2斤"}], [], []))
    monkeypatch.setattr(
        mcp_server, "build_review_workbook", lambda *a, **k: calls.append("xlsx") or b"xlsx-bytes"
    )
    monkeypatch.setattr(mcp_server, "build_report", lambda *a, **k: calls.append("report") or b"<html/>")

    def _forbidden_post(*args, **kwargs):  # noqa: ANN002, ANN003
        calls.append("post")
        raise AssertionError("屏蔽期间不应发生任何回写请求")

    monkeypatch.setattr(httpx, "post", _forbidden_post)

    result = mcp_server.fresh_order_parse(
        image_path="http://example.test/order1.png",
        sku_path="http://example.test/sku.xlsx",
    )

    assert calls == [], f"不应生成/回写任何产物，实际发生了：{calls}"
    assert set(result) == _TRIPLE_KEYS


def test_flipping_the_switch_does_generate_and_post(monkeypatch):
    """反向对照：把闸门临时打开，同一条链路立刻出现生成与 POST。

    没有这条，"断言调用次数为 0"可能只是递归器没接上；有了它，上面那条才算真的在证明屏蔽。
    """
    import mcp_server

    calls: list[str] = []
    monkeypatch.setattr(mcp_server, "load_product_data_three", lambda *a, **k: object())
    monkeypatch.setattr(mcp_server, "_analyze_image", lambda *a, **k: ([], [], []))
    monkeypatch.setattr(
        mcp_server, "build_review_workbook", lambda *a, **k: calls.append("xlsx") or b"xlsx-bytes"
    )
    monkeypatch.setattr(mcp_server, "build_report", lambda *a, **k: calls.append("report") or b"<html/>")

    def _recording_post(*args, **kwargs):  # noqa: ANN002, ANN003
        calls.append("post")
        raise RuntimeError("网络不可用（本用例只验证链路是否走到回写）")

    monkeypatch.setattr(httpx, "post", _recording_post)
    monkeypatch.setattr(mcp_server, "OUTPUT_DELIVERY_ENABLED", True)

    out = mcp_server._maybe_deliver(
        {"auto_rows": [], "auto_count": 0, "review_rows": [], "review_count": 0,
         "error_rows": [], "error_count": 0},
        result_url="http://example.test/api/files/put?sig=x&exp=1",
        source_name="order1.png",
        auto_rows=[],
        review_rows=[],
        error_rows=[],
    )

    assert "report" in calls and "xlsx" in calls and "post" in calls
    assert "delivery_note" in out, "回写失败时应降级成说明，而不是丢掉解析结果"


def test_maybe_deliver_is_a_noop_even_with_a_valid_url():
    """闸门关着时，即便硬塞一个合法回写地址也原样返回 —— 两道关都得挡。"""
    import mcp_server

    result = {"auto_rows": [], "auto_count": 0, "review_rows": [], "review_count": 0,
              "error_rows": [], "error_count": 0}

    out = mcp_server._maybe_deliver(
        result,
        result_url="http://example.test/api/files/put?sig=x&exp=1",
        source_name="order1.png",
        auto_rows=[],
        review_rows=[],
        error_rows=[],
    )

    assert out == result
    assert "filePath" not in out and "excelFile" not in out and "delivery_note" not in out
