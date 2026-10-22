# -*- coding: utf-8 -*-
"""产出回写（``resultUrl``）单测：拼地址 + POST + 失败降级。

为什么单独一层：`test_server_e2e.py` 要真实 BOM 数据才能跑（数据不在位时整层 skip），
而"回写这一跳"是本服务**唯一**的交付通道——不能只在有数据的环境里被验证。
这一层不碰 BOM 业务，只喂字节，因此任何环境都能跑。

依据（契约 §4.3 / §4.6）：原有 query 一个不丢、``filename`` / ``summary`` 追加、
body 必须是平台认识的"原样字节"类型、成功看 202 且响应里有 ``path``、
失败**不给假路径**。
"""
import http.server
import importlib.util
import json
import threading
import urllib.parse

import pytest

pytestmark = pytest.mark.skipif(importlib.util.find_spec("mcp") is None,
                               reason="未安装 mcp（仅运行期依赖），跳过回写测试")


class _Sink(http.server.BaseHTTPRequestHandler):
    """假平台：记录收到的请求，按 ``status`` 回包。"""

    last: dict = {}
    calls = 0
    status = 202
    reply = None

    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length)
        parsed = urllib.parse.urlsplit(self.path)
        cls = type(self)
        cls.calls += 1
        cls.last = {"path": parsed.path, "query": parsed.query, "body": body,
                    # 头名大小写由发送方决定，统一转小写后再断言
                    "headers": {k.lower(): v for k, v in self.headers.items()}}
        payload = cls.reply if cls.reply is not None else json.dumps(
            {"path": "临时空间/后台产出/th_1_x.xlsx", "size": len(body)}, ensure_ascii=False)
        raw = payload.encode("utf-8")
        self.send_response(cls.status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


@pytest.fixture()
def sink():
    handler = type("Sink", (_Sink,), {"last": {}, "calls": 0, "status": 202, "reply": None})
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}/api/files/put", handler
    finally:
        srv.shutdown()


def server_module():
    import server
    return server


# ---------------------------------------------------------------- 拼地址

def test_put_url_keeps_every_injected_param():
    """平台注入的 query（u/d/exp/sig/sid/call_id/tool/t）**一个都不许丢**——丢了就是 403。"""
    srv = server_module()
    url = ("http://backend:3000/api/files/put?u=u1&d=%E4%B8%B4%E6%97%B6%E7%A9%BA%E9%97%B4"
           "&exp=1999999999999&sig=deadbeef&sid=th_1&call_id=c1&tool=bom__bom_merge&t=123")
    out = srv._put_url(url, "总BOM_X_bom_1_ab.xlsx", "合并完成：3 行")
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(out).query))
    assert query["u"] == "u1" and query["sig"] == "deadbeef" and query["t"] == "123"
    assert query["sid"] == "th_1" and query["call_id"] == "c1"
    assert query["tool"] == "bom__bom_merge"
    assert query["d"] == "临时空间"                       # 编码/解码往返不改变值
    assert query["filename"] == "总BOM_X_bom_1_ab.xlsx"
    assert query["summary"] == "合并完成：3 行"


def test_put_url_keeps_fragment_and_handles_empty_summary():
    """fragment 不丢；摘要为空时不写这个参数（平台侧缺省即"服务没给"）。"""
    srv = server_module()
    out = srv._put_url("http://h/api/files/put?u=u1#frag", "a.xlsx", "")
    parts = urllib.parse.urlsplit(out)
    assert parts.fragment == "frag"
    assert "summary" not in dict(urllib.parse.parse_qsl(parts.query))
    assert dict(urllib.parse.parse_qsl(parts.query))["filename"] == "a.xlsx"


# ---------------------------------------------------------------- 回写

def test_deliver_posts_bytes_and_returns_path(sink):
    """成功：octet-stream 原样字节 + 202 里的 ``path`` 原样返回。"""
    url, fake = sink
    srv = server_module()
    path, err = srv._deliver(url, "a.xlsx", b"PK\x03\x04bytes", "合并完成")
    assert err == ""
    assert path == "临时空间/后台产出/th_1_x.xlsx"
    assert fake.calls == 1
    assert fake.last["body"] == b"PK\x03\x04bytes"
    # 平台只给 octet-stream / text/plain 注册了 Buffer parser；发别的 MIME 会被判 415
    assert fake.last["headers"]["content-type"] == "application/octet-stream"
    query = dict(urllib.parse.parse_qsl(fake.last["query"]))
    assert query["filename"] == "a.xlsx" and query["summary"] == "合并完成"


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


def test_deliver_reports_non_json_reply(sink):
    """响应不是 JSON：给可读原因，不给路径。"""
    url, fake = sink
    fake.reply = "<html>ok</html>"
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


def test_deliver_degrades_on_unreachable_endpoint():
    """端点不可达（或本机代理挡在前面）：收敛成一行原因 + 空路径，绝不穿透成 500。

    不断言具体文案：连接被拒是 ``回写请求失败``，而本机若配了 HTTP 代理、请求被代理接走，
    则会得到 ``回写被拒（HTTP 5xx）``——两者都是"没有交付"，对接线人都是同一句结论。
    """
    srv = server_module()
    path, err = srv._deliver("http://127.0.0.1:1/api/files/put?u=u1", "a.xlsx", b"PK", "x")
    assert path == ""
    assert err.strip() != ""
