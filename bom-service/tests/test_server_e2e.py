# -*- coding: utf-8 -*-
"""MCP 层端到端测试：真起服务、真走协议、真下载产出。

链路：真实数据（BOM提交/）→ 本机静态服务铸成 http 直链 → 真实 ``server.py`` 进程
→ MCP 客户端 ``tools/call`` → 结果里带回下载地址 → **用这个地址把 xlsx 真下下来**。

这一层专门守住"注册得起来、参数齐、产出真能拿到"——``server.py`` 里
``@mcp.tool(structured_output=False)`` 与"工具内不得阻塞事件循环"那两条注释就是它要防的坑
（前者会让工具注册直接失败，后者会让并发调用互相卡死）。

只测 streamable-http：本服务只提供这一种传输——下载地址要能点开，前提就是进程真的在监听端口。
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
from pathlib import Path
from urllib.parse import quote

import httpx
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


@pytest.fixture(scope="module")
def mcp_server(tmp_path_factory):
    """真起 ``server.py``（streamable-http），产出目录与对外基址都指到测试自己的位置。"""
    port = _free_port()
    artifacts = tmp_path_factory.mktemp("artifacts")
    # 服务端日志必须**落文件**，绝不能挂一个没人读的管道：
    # uvicorn/httpx 每次请求都会打日志（Rich 还会把长 URL 折成十几行），管道写满后
    # `logger` 调用会阻塞事件循环 ⇒ 服务端整个卡死、响应永远发不出去。
    # 症状极具迷惑性：几乎不产生日志的用例（输入不可达）能过，一算就有大量日志的用例必卡。
    # 落文件既不阻塞，失败时还能把服务端日志打出来定位。
    log_path = tmp_path_factory.mktemp("mcp") / "server.log"
    log_file = open(log_path, "wb")
    env = {
        **os.environ,
        "BOM_MCP_PORT": str(port),
        # 产出落盘到测试专属目录：不污染仓库，也便于断言"文件真在那儿"
        "BOM_ARTIFACT_DIR": str(artifacts),
        # 铸地址用的对外基址：用户（这里是测试）能访问到的就是 127.0.0.1:port
        "BOM_PUBLIC_BASE_URL": f"http://127.0.0.1:{port}",
    }
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
               "artifacts": Path(artifacts),
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
    """校验是纯计算工具：同一轮拿回完整汇总，**没有产出**（artifact 为空、也不给下载地址）。"""
    text, _ = mcp_call(mcp_server["url"], "bom_validate", file_args(static_url), timeout=60)
    payload = json.loads(text[0])
    assert payload["status"] == "success", payload["message"]
    assert payload["summary"]["tree"]["nodes"] == EXPECTED_NODES
    assert payload["artifact"] is None
    assert "viewUrl" not in payload and "viewUrlName" not in payload
    assert list(mcp_server["artifacts"].iterdir()) == []      # 校验不落任何文件


def test_merge_returns_summary_and_downloadable_url(mcp_server, static_url):
    """合并：**同一轮**返回结果 + 下载地址，并且这个地址真能把那份 xlsx 下下来。"""
    text, _ = mcp_call(mcp_server["url"], "bom_merge", file_args(static_url), timeout=120)
    payload = json.loads(text[0])
    assert payload["status"] == "success", payload["message"]
    assert payload["summary"]["tree"]["nodes"] == EXPECTED_NODES
    # 结果统计就在这一次返回里（同步：不再有"受理时算不出来"这回事）
    assert payload["summary"]["counts"]["error"] == 0
    name = payload["artifact"]["filename"]
    assert payload["viewUrlName"] == name
    assert name.startswith("总BOM_WCCMT-00000B0570_bom_") and name.endswith(".xlsx")
    assert payload["artifact"]["rows"] == EXPECTED_NODES and payload["artifact"]["bytes"] > 0
    assert payload["viewUrl"].startswith(mcp_server["base"] + "/files/")

    # 用返回的地址真下一遍：拿到的必须是能打开的 xlsx，且下载名是那个中文名
    r = httpx.get(payload["viewUrl"], timeout=30)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert quote(name) in r.headers["content-disposition"]
    wb = load_workbook(filename=__import__("io").BytesIO(r.content))
    assert wb.sheetnames == ["Total BOM", "校验汇总"]
    assert wb["Total BOM"].max_row == EXPECTED_NODES + 1      # 表头 + 数据行


def test_merge_output_is_stored_atomically(mcp_server, static_url):
    """落盘侧：产出目录里能看到那个文件，且**没有 .tmp 残留**（原子写不留中间态）。"""
    text, _ = mcp_call(mcp_server["url"], "bom_merge", file_args(static_url), timeout=120)
    name = json.loads(text[0])["artifact"]["filename"]
    stored = sorted(p.name for p in mcp_server["artifacts"].iterdir())
    assert name in stored
    assert not [n for n in stored if n.endswith(".tmp")]


def test_merge_blocked_by_error_has_no_output(mcp_server, static_url):
    """有阻断性错误时不产出 BOM：status=failed，artifact 为空，也没有下载地址。"""
    before = sorted(p.name for p in mcp_server["artifacts"].iterdir())
    args = {**file_args(static_url), "total_bom_sheet": "不存在的表"}
    text, _ = mcp_call(mcp_server["url"], "bom_merge", args, timeout=120)
    payload = json.loads(text[0])
    assert payload["status"] == "failed"
    assert "E011" in {i["code"] for i in payload["issues"]}
    assert payload["artifact"] is None
    assert "viewUrl" not in payload
    assert sorted(p.name for p in mcp_server["artifacts"].iterdir()) == before


def test_download_route_rejects_unknown_and_unsafe_names(mcp_server):
    """下载端点只服务自己认得出的产出名：不存在、后缀不对、想穿越路径 → 一律 404。"""
    for name in ("没有这个.xlsx", "notes.txt", "..%2F..%2Fetc%2Fpasswd"):
        r = httpx.get(f"{mcp_server['base']}/files/{name}", timeout=10)
        assert r.status_code == 404, f"{name} 应被拒"
