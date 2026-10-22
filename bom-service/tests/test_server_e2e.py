# -*- coding: utf-8 -*-
"""MCP 层端到端测试：真起服务、真走协议、**真把产出回写出去**。

链路：真实数据（BOM提交/）→ 本机静态服务铸成 http 直链 → 真实 ``server.py`` 进程
→ MCP 客户端 ``tools/call``（带平台注入的 ``resultUrl``）→ 服务算完 **POST 到假回写端点**
→ 结果里带回 ``filePath``，且那个端点收到的字节是**能打开的 xlsx**。

这一层专门守住"注册得起来、参数齐、产出真能送出去"——``server.py`` 里
``@mcp.tool(structured_output=False)`` 与"工具内不得阻塞事件循环"那两条注释就是它要防的坑
（前者会让工具注册直接失败，后者会让并发调用互相卡死）。

只测 streamable-http：本服务只提供这一种传输。
"""
import asyncio
import functools
import http.server
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
from pathlib import Path
from urllib.parse import quote

import pytest
from openpyxl import load_workbook

REPO = Path(__file__).resolve().parents[2]
SERVICE = Path(__file__).resolve().parents[1]
SUBMIT = REPO / "BOM提交"
ZIP_NAME = "子BOM.zip"
TOTAL_BOM_NAME = "WCCMT-00000B0570_00_0B.xls"
SCHEMA_NAME = "总BOM标准字段.json"
MAPPING_NAME = "子BOM字段映射.json"

#: 真实数据展开行数（含根行），与 ``test_integration_real.EXPECTED_NODES`` 同源：
#: 含 5 行"mat_code 空、posiz 有值"的外购/标准件明细（曾经被整行丢掉）
EXPECTED_NODES = 327

pytestmark = pytest.mark.skipif(
    not (SUBMIT / ZIP_NAME).exists() or not (REPO / SCHEMA_NAME).exists(),
    reason="真实数据不在位，跳过端到端测试",
)


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):        # 测试输出保持干净
        pass


def _serve(handler_cls):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def _port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _free_port() -> int:
    # 缺省端口在本机可能已被别的程序占用（实测如此），不与之抢
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def static_url():
    srv = _serve(functools.partial(_Quiet, directory=str(REPO)))
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}"
    finally:
        srv.shutdown()


class _PutSink(http.server.BaseHTTPRequestHandler):
    """假的平台回写端点（``POST /api/files/put``）：收字节、记录请求、回 202 + ``path``。"""

    #: 最近一次请求（测试断言用）：``{"path":…, "query":{…}, "body":b"…", "headers":{…}}``
    last: dict = {}
    #: 收到的次数（失败场景断言"一次都没发"）
    calls = 0
    #: 返回状态码（换成 403 可测"回写被拒"）
    status = 202

    def log_message(self, *args):        # 测试输出保持干净
        pass

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length)
        parsed = urllib.parse.urlsplit(self.path)
        query = {k: v[-1] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        cls = type(self)
        cls.calls += 1
        cls.last = {"path": parsed.path, "query": query, "body": body,
                    "headers": dict(self.headers)}
        if cls.status != 202:
            self.send_response(cls.status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(b'{"error":{"code":"FILE_SIGN_INVALID"}}')
            return
        # 平台落盘名的形状：`临时空间/后台产出/{sid}_{服务给的文件名}`
        rel = f"临时空间/后台产出/{query.get('sid', 'u')}_{query.get('filename', 'x.xlsx')}"
        payload = json.dumps({"path": rel, "size": len(body)}, ensure_ascii=False).encode("utf-8")
        self.send_response(202)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


@pytest.fixture()
def put_sink():
    """每个用例一个干净的假回写端点；返回 (base_url, 端点类)。"""
    handler = type("Sink", (_PutSink,), {"last": {}, "calls": 0, "status": 202})
    srv = _serve(handler)
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}", handler
    finally:
        srv.shutdown()


@pytest.fixture(scope="module")
def mcp_server(tmp_path_factory):
    """真起 ``server.py``（streamable-http）。服务不落盘，故只需给一个空闲端口。"""
    port = _free_port()
    # 服务端日志必须**落文件**，绝不能挂一个没人读的管道：
    # uvicorn/httpx 每次请求都会打日志（Rich 还会把长 URL 折成十几行），管道写满后
    # `logger` 调用会阻塞事件循环 ⇒ 服务端整个卡死、响应永远发不出去。
    # 症状极具迷惑性：几乎不产生日志的用例（输入不可达）能过，一算就有大量日志的用例必卡。
    # 落文件既不阻塞，失败时还能把服务端日志打出来定位。
    log_path = tmp_path_factory.mktemp("mcp") / "server.log"
    log_file = open(log_path, "wb")
    env = {**os.environ, "BOM_MCP_PORT": str(port)}
    proc = subprocess.Popen([sys.executable, "-u", "server.py"], cwd=str(SERVICE), env=env,
                            stdout=log_file, stderr=subprocess.STDOUT)

    def server_log():
        return log_path.read_text(encoding="utf-8", errors="replace")

    try:
        deadline = time.time() + 30
        while time.time() < deadline and not _port_open(port):
            if proc.poll() is not None:
                pytest.fail(f"server.py 启动即退出：\n{server_log()[-2000:]}")
            time.sleep(0.3)
        if not _port_open(port):
            pytest.fail(f"server.py 30 秒内未监听 {port}\n{server_log()[-2000:]}")
        yield {"url": f"http://127.0.0.1:{port}/mcp",
               "base": f"http://127.0.0.1:{port}",
               "log": server_log}
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log_file.close()


def _run_async(coro_factory, timeout: float):
    """在守护线程里跑一个协程并 join，保证"卡住 = 失败"，绝不让测试套件挂死。

    必须这么防：mcp 1.26 的 ``streamablehttp_client`` 在取消路径上会卡在会话终止
    （日志 ``Session termination failed``），实测一次清理要 5 分钟，远超预算。
    """
    box: dict = {}

    def worker():
        try:
            box["ok"] = asyncio.run(asyncio.wait_for(coro_factory(), timeout))
        except BaseException as e:                       # noqa: BLE001
            box["err"] = e

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    t.join(timeout + 5)
    if t.is_alive():                                     # 清理都卡住：放弃，判失败
        raise TimeoutError(f"MCP 调用在 {timeout + 5:g} 秒内未返回（含清理）")
    if "err" in box:
        raise box["err"]
    return box["ok"]


def mcp_call(url: str, tool: str, arguments: dict, timeout: float = 30.0):
    """streamable-http 调用：建连 → 初始化 → 调工具，返回 (text, tool_names)。"""
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    async def run():
        async with streamablehttp_client(url) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                names = [t.name for t in (await session.list_tools()).tools]
                result = await session.call_tool(tool, arguments=arguments)
                return [c.text for c in result.content if getattr(c, "text", None)], names

    return _run_async(run, timeout)


def _url(static_url, rel_dir, name):
    path = f"{rel_dir}/{name}" if rel_dir else name
    return f"{static_url}/" + quote(path)


def file_args(static_url):
    """两个工具共有的四个文件参数（对外是相对路径口径；这里直接传铸造后的直链，模拟平台注入）。"""
    return {
        "sub_bom_zip_path": _url(static_url, "BOM提交", ZIP_NAME),
        "total_bom_path": _url(static_url, "BOM提交", TOTAL_BOM_NAME),
        "schema_path": _url(static_url, "", SCHEMA_NAME),
        "mapping_path": _url(static_url, "", MAPPING_NAME),
    }


def test_tools_registered_and_inputs_are_reported_when_unreachable(mcp_server):
    """工具注册成功；输入取不到时返回**标准 JSON 失败结果**（而不是 500/异常）。"""
    text, names = mcp_call(mcp_server["url"], "bom_validate", file_args("http://127.0.0.1:1"),
                           timeout=60)
    assert set(names) == {"bom_validate", "bom_merge"}
    assert text
    payload = json.loads(text[0])
    assert payload["status"] == "failed"
    assert {i["code"] for i in payload["issues"]} == {"E001"}
    assert {i["target"] for i in payload["issues"]} == {
        "sub_bom_zip_path", "total_bom_path", "schema_path", "mapping_path"}


def test_validate_returns_summary_and_no_output(mcp_server, static_url):
    """校验是纯计算工具：同一轮拿回完整汇总，**没有产出**（artifact 为空、也没有 filePath）。"""
    text, _ = mcp_call(mcp_server["url"], "bom_validate", file_args(static_url), timeout=60)
    payload = json.loads(text[0])
    assert payload["status"] == "success", payload["message"]
    assert payload["summary"]["tree"]["nodes"] == EXPECTED_NODES
    assert payload["artifact"] is None
    assert "filePath" not in payload and "filePathName" not in payload
    assert "viewUrl" not in payload and "viewUrlName" not in payload


def test_merge_writes_back_to_result_url(mcp_server, static_url, put_sink):
    """合并：**同一轮**返回统计 + 把 xlsx POST 到「平台回写地址」，并把返回的 path 作为 filePath。"""
    sink_url, sink = put_sink
    # 平台注入的地址都带原有一串 query（u/d/exp/sig/sid/call_id/tool）——服务必须一个不丢
    result_url = (f"{sink_url}/api/files/put?u=u1&d=%E4%B8%B4%E6%97%B6%E7%A9%BA%E9%97%B4"
                  f"&exp=1999999999999&sig=deadbeef&sid=th_1&call_id=c1&tool=bom__bom_merge")
    text, _ = mcp_call(mcp_server["url"], "bom_merge",
                       {**file_args(static_url), "resultUrl": result_url}, timeout=120)
    payload = json.loads(text[0])
    assert payload["status"] == "success", payload["message"]
    assert payload["summary"]["tree"]["nodes"] == EXPECTED_NODES
    # 结果统计就在这一次返回里（同步：不再有"受理时算不出来"这回事）
    assert payload["summary"]["counts"]["error"] == 0

    name = payload["artifact"]["filename"]
    assert name.startswith("总BOM_WCCMT-00000B0570_bom_") and name.endswith(".xlsx")
    assert payload["artifact"]["rows"] == EXPECTED_NODES and payload["artifact"]["bytes"] > 0
    # 入口改为文件空间路径：值与"平台返回的 path"一致，不再是自铸的下载地址
    assert sink.calls == 1
    assert payload["filePath"].startswith("临时空间/后台产出/")   # 平台返回的权威路径，原样搬运
    assert payload["filePath"].endswith(f"th_1_{name}")
    assert payload["filePathName"] == name
    assert "viewUrl" not in payload and "viewUrlName" not in payload

    # 回写请求本身：原有 query 一个不丢、文件名/摘要齐、body 是能打开的 xlsx
    query = sink.last["query"]
    assert query["u"] == "u1" and query["sig"] == "deadbeef" and query["sid"] == "th_1"
    assert query["call_id"] == "c1" and query["tool"] == "bom__bom_merge"
    assert query["filename"] == name
    assert query["summary"]                      # 摘要必须有（界面标题的唯一来源）
    # 回写必须是"原样收字节"的类型：平台只给 octet-stream / text/plain 注册了 Buffer parser
    assert sink.last["headers"]["content-type"] == "application/octet-stream"
    wb = load_workbook(filename=__import__("io").BytesIO(sink.last["body"]))
    assert wb.sheetnames == ["Total BOM", "校验汇总"]
    assert wb["Total BOM"].max_row == EXPECTED_NODES + 1      # 表头 + 数据行


def test_merge_without_result_url_gives_no_file_path(mcp_server, static_url):
    """没有回写地址（直接调用服务）：结果照给，但**不给任何入口**——不编假路径。"""
    text, _ = mcp_call(mcp_server["url"], "bom_merge", file_args(static_url), timeout=120)
    payload = json.loads(text[0])
    assert payload["status"] == "success"
    assert payload["artifact"] is not None
    assert "filePath" not in payload and "filePathName" not in payload
    assert "未收到回写地址" in payload["message"]


def test_merge_blocked_by_error_has_no_output(mcp_server, static_url, put_sink):
    """有阻断性错误时不产出 BOM：status=failed、artifact 为空、**一次回写都不发**。"""
    sink_url, sink = put_sink
    args = {**file_args(static_url), "total_bom_sheet": "不存在的表",
            "resultUrl": f"{sink_url}/api/files/put?u=u1&d=d&exp=1&sig=x"}
    text, _ = mcp_call(mcp_server["url"], "bom_merge", args, timeout=120)
    payload = json.loads(text[0])
    assert payload["status"] == "failed"
    assert "E011" in {i["code"] for i in payload["issues"]}
    assert payload["artifact"] is None
    assert "filePath" not in payload
    assert sink.calls == 0


def test_merge_put_failure_does_not_fake_output(mcp_server, static_url, put_sink):
    """回写被拒（403）：**不假装有产出** —— 不给 filePath，原因写进 message。"""
    sink_url, sink = put_sink
    sink.status = 403
    text, _ = mcp_call(mcp_server["url"], "bom_merge",
                       {**file_args(static_url),
                        "resultUrl": f"{sink_url}/api/files/put?u=u1&d=d&exp=1&sig=x"},
                       timeout=120)
    payload = json.loads(text[0])
    assert sink.calls == 1
    assert "filePath" not in payload
    assert "产出未交付" in payload["message"] and "403" in payload["message"]
