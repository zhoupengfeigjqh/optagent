# -*- coding: utf-8 -*-
"""产出回写（``resultUrl``）单测：拼地址 + POST + 降级链。

为什么单独一层：OCR 与真实订单数据都不在位时也能验"交付这一跳"——而它是本服务
**唯一**产出通道（契约见仓库根 ``异步MCP服务接入约定.md`` §4.7.1）。

依据：原有 query 一个不丢、``filename``/``summary`` 追加、body 必须是平台认识的
"原样字节"类型、成功看 202 且响应里有 ``path``、失败**不给假路径**、
两份产出的**键序**决定界面入口顺序（报告在前、xlsx 在后）。
"""
import http.server
import importlib.util
import json
import threading
import urllib.parse
from datetime import datetime

import pytest

_REQUIRED = ("fastmcp", "pandas", "rapidfuzz")
pytestmark = pytest.mark.skipif(
    any(importlib.util.find_spec(name) is None for name in _REQUIRED),
    reason="未安装运行期依赖（fastmcp / pandas / rapidfuzz），跳过回写测试",
)


class _Sink(http.server.BaseHTTPRequestHandler):
    """假平台：记录收到的每个请求，按 ``fail_suffix`` / ``status`` 回包。"""

    last: dict = {}
    calls = 0
    sent: list = []
    status = 202
    reply = None
    fail_suffix: str | None = None

    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length)
        parsed = urllib.parse.urlsplit(self.path)
        query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
        cls = type(self)
        cls.calls += 1
        cls.last = {
            "path": parsed.path,
            "query": parsed.query,
            "body": body,
            # 头名大小写由发送方决定，统一转小写后再断言
            "headers": {k.lower(): v for k, v in self.headers.items()},
        }
        cls.sent.append({"filename": query.get("filename"), "body": body,
                         "query": query, "headers": cls.last["headers"]})

        rejected = cls.fail_suffix and (query.get("filename") or "").endswith(cls.fail_suffix)
        status = 403 if rejected else cls.status
        payload = cls.reply if cls.reply is not None else json.dumps(
            {"path": f"临时空间/后台产出/th_1_{query.get('filename')}", "size": len(body)},
            ensure_ascii=False)
        raw = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


@pytest.fixture()
def sink():
    handler = type("Sink", (_Sink,), {
        "last": {}, "calls": 0, "sent": [], "status": 202, "reply": None, "fail_suffix": None,
    })
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        base = f"http://127.0.0.1:{srv.server_address[1]}/api/files/put"
        yield (f"{base}?u=u1&d=%E6%95%B0%E6%8D%AE%E5%9F%9F%2F%E4%B8%B4%E6%97%B6%E7%A9%BA%E9%97%B4"
               f"%2F%E5%90%8E%E5%8F%B0%E4%BA%A7%E5%87%BA&exp=1999999999999&sig=deadbeef"
               f"&sid=th_1&call_id=c1&tool=fresh__fresh_order_parse&t=123"), handler
    finally:
        srv.shutdown()


def server_module():
    import mcp_server
    return mcp_server


def _auto_row():
    return {"raw_line": "洋芋2斤", "normalized_name": "土豆", "quantity": "2斤", "unit": "斤",
            "removed_tokens": [], "synonym_applied": "洋芋→土豆", "loose_applied": False,
            "matched_name": "土豆", "sku_id": "VEG-002", "score": 100.0,
            "order_no": 1, "source": "order1.png"}


def _review_row():
    return {"raw_line": "蕃茄3斤", "normalized_name": "蕃茄", "quantity": "3斤", "unit": "斤",
            "index": 0, "top_score": 60.0,
            "candidates": [{"name": "小番茄", "score": 60.0, "sku_id": "FRU-021"}],
            "order_no": 1, "source": "order1.png"}


def _error_row():
    return {"raw_line": "士豆", "normalized_name": "士豆", "quantity": "1斤", "unit": "斤",
            "error_type": "NO_SKU_MATCH", "top_candidate": None, "top_score": None,
            "candidates": [], "message": "未匹配到任何启用商品",
            "order_no": 1, "source": "order1.png"}


def _deliver_outputs(srv, url, base="生鲜订单_order1_20261113_153012"):
    return srv._deliver_outputs(
        url, base=base, source_name="order1.png",
        auto_rows=[_auto_row()], review_rows=[_review_row()], error_rows=[_error_row()],
    )


# ---------------------------------------------------------------- 拼地址

def test_put_url_keeps_every_injected_param():
    """平台注入的 query（u/d/exp/sig/sid/call_id/tool/t）**一个都不许丢**——丢了就是 403。"""
    srv = server_module()
    url = ("http://backend:3000/api/files/put?u=u1&d=agent%2F临时空间%2F后台产出"
           "&exp=1999999999999&sig=deadbeef&sid=th_1&call_id=c1"
           "&tool=fresh__fresh_order_parse&t=123")
    out = srv._put_url(url, "生鲜订单_order1_1.xlsx", "解析结果：高度匹配 1 行")
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(out).query))
    assert query["u"] == "u1" and query["sig"] == "deadbeef" and query["t"] == "123"
    assert query["sid"] == "th_1" and query["call_id"] == "c1"
    assert query["tool"] == "fresh__fresh_order_parse"
    assert query["d"] == "agent/临时空间/后台产出"          # 编码/解码往返不改变值
    assert query["filename"] == "生鲜订单_order1_1.xlsx"
    assert query["summary"] == "解析结果：高度匹配 1 行"


def test_put_url_keeps_fragment_and_handles_empty_summary():
    """fragment 不丢；摘要为空时不写这个参数（平台侧缺省即"服务没给"）。"""
    srv = server_module()
    out = srv._put_url("http://h/api/files/put?u=u1#frag", "a.xlsx", "")
    parts = urllib.parse.urlsplit(out)
    assert parts.fragment == "frag"
    query = dict(urllib.parse.parse_qsl(parts.query))
    assert "summary" not in query and query["filename"] == "a.xlsx"


# ---------------------------------------------------------------- 回写

def test_deliver_posts_bytes_and_returns_path(sink):
    """成功：octet-stream 原样字节 + 202 里的 ``path`` 原样返回。"""
    url, fake = sink
    srv = server_module()
    path, err = srv._deliver(url, "a.xlsx", b"PK\x03\x04bytes", "解析结果")
    assert err == ""
    assert path == "临时空间/后台产出/th_1_a.xlsx"
    assert fake.calls == 1
    assert fake.last["body"] == b"PK\x03\x04bytes"
    # 平台只给 octet-stream / text/plain 注册了 Buffer parser；发别的 MIME 会被判 415
    assert fake.last["headers"]["content-type"] == "application/octet-stream"


@pytest.mark.parametrize("status", [400, 403, 413, 500])
def test_deliver_reports_rejection_without_path(sink, status):
    """非 200/202：**不给路径**，只回一行原因（调用方据此不写 filePath）。"""
    url, fake = sink
    fake.status = status
    srv = server_module()
    path, err = srv._deliver(url, "a.xlsx", b"PK", "x")
    assert path == ""
    assert str(status) in err and "回写被拒" in err


def test_deliver_reports_missing_path(sink):
    """202 但没有 ``path``（平台改了响应形状）：同样不给路径，不猜。"""
    url, fake = sink
    fake.reply = '{"size": 2}'
    srv = server_module()
    path, err = srv._deliver(url, "a.xlsx", b"PK", "x")
    assert path == "" and "path" in err


def test_deliver_skips_request_when_too_large(sink, monkeypatch):
    """超过平台 bodyLimit：**先判大小、不白传一遍**（契约 §4.6）。"""
    url, fake = sink
    srv = server_module()
    monkeypatch.setattr(srv, "_MAX_RESULT_BYTES", 4)
    path, err = srv._deliver(url, "a.xlsx", b"12345", "x")
    assert path == ""
    assert "超过回写上限" in err
    assert fake.calls == 0


def test_network_error_does_not_raise():
    """连不上平台：返回一行原因，绝不穿透成工具错误（解析结果照给）。"""
    srv = server_module()
    path, err = srv._deliver("http://127.0.0.1:1/api/files/put", "a.xlsx", b"PK", "x")
    assert path == "" and "回写请求失败" in err


# ---------------------------------------------------------------- 取值与命名

@pytest.mark.parametrize("value", ["", "   ", "临时空间/订单1.png", "ftp://h/x", "javascript:alert(1)"])
def test_invalid_result_url_degrades_to_empty(value):
    """非 http/https 一律当"没有回写地址"（契约 §6 第 2 条），且**不抛错**。"""
    srv = server_module()
    assert srv._valid_result_url(value) == ""


def test_valid_result_url_kept():
    srv = server_module()
    url = "http://backend:3000/api/files/put?u=u1"
    assert srv._valid_result_url(url) == url


def test_job_base_sanitizes_unsafe_filename():
    """产出名必须是单段、无 ``..``、无路径分隔符——否则平台拒写/入口被丢。"""
    srv = server_module()
    base = srv._job_base("../a/b:c*?d.png", datetime(2026, 11, 13, 15, 30, 12))
    assert base.startswith("生鲜订单_b_c")
    assert base.endswith("_20261113_153012")
    for char in '/\\:*?"<>|':
        assert char not in base
    assert ".." not in base


def test_job_base_falls_back_when_name_is_empty():
    srv = server_module()
    assert srv._job_base("", datetime(2026, 11, 13, 15, 30, 12)) == "生鲜订单_订单_20261113_153012"


# ---------------------------------------------------------------- 双产出与降级

def test_deliver_outputs_writes_workbook_then_report(sink):
    """两个文件两次 POST；返回的**键序**决定界面顺序：报告在前，xlsx 在后。"""
    url, fake = sink
    srv = server_module()
    entries, note = _deliver_outputs(srv, url)

    assert note == ""
    assert list(entries) == ["filePath", "filePathName", "excelFile"]
    assert entries["filePathName"].endswith("_报告.html")
    assert entries["excelFile"]["filePathName"].endswith(".xlsx")
    assert entries["filePath"].startswith("临时空间/后台产出/")

    assert fake.calls == 2
    workbook_hit, report_hit = fake.sent
    assert workbook_hit["filename"].endswith(".xlsx") and workbook_hit["body"][:2] == b"PK"
    assert report_hit["filename"].endswith("_报告.html")
    assert report_hit["body"].decode("utf-8").startswith("<!doctype html>")
    # 报告同样是 octet-stream 原样字节（平台只给这两种类型注册了 Buffer parser）
    assert report_hit["headers"]["content-type"] == "application/octet-stream"
    assert "解析报告" in report_hit["query"]["summary"]


def test_deliver_outputs_falls_back_to_report_when_workbook_rejected(sink):
    """xlsx 被拒：报告照交（顶层仍是报告），说明里点名且**不给 excelFile**。"""
    url, fake = sink
    fake.fail_suffix = ".xlsx"
    srv = server_module()
    entries, note = _deliver_outputs(srv, url)

    assert list(entries) == ["filePath", "filePathName"]
    assert entries["filePathName"].endswith("_报告.html")
    assert "三表工作簿未交付" in note and "403" in note


def test_deliver_outputs_falls_back_to_workbook_when_report_rejected(sink):
    """报告被拒：顶层退回 xlsx，且**不给 excelFile**（同一文件不给两条入口）。"""
    url, fake = sink
    fake.fail_suffix = ".html"
    srv = server_module()
    entries, note = _deliver_outputs(srv, url)

    assert list(entries) == ["filePath", "filePathName"]
    assert entries["filePathName"].endswith(".xlsx")
    assert "解析报告未交付" in note and "403" in note


def test_deliver_outputs_no_entries_when_nothing_generated(sink, monkeypatch):
    """两份都生成不出来：**一个入口都不给**（不假装有产出），原因进说明。"""
    url, fake = sink
    srv = server_module()
    monkeypatch.setattr(srv, "_workbook_bytes", lambda *_a, **_k: None)
    monkeypatch.setattr(srv, "_report_bytes", lambda *_a, **_k: None)
    entries, note = _deliver_outputs(srv, url)

    assert entries == {}
    assert fake.calls == 0
    assert "三表工作簿未生成" in note and "解析报告未生成" in note
