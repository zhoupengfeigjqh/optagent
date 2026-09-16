"""ocr_core 纯逻辑单测

运行方式（**宿主机本地**；宪章原则三：测试环境＝仅本地，容器 MUST NOT 承担测试职责）：
    cd ocr-service && pip install -r requirements-test.txt && python -m pytest -q tests

覆盖：白名单默认拒绝、命中放行、大小写与空白处理、scheme 校验，
以及下载的 HTTP 状态与大小上限（经 ``httpx.MockTransport`` 注入，不发真实请求）。
"""
import importlib

import httpx
import pytest


def _load_core(monkeypatch, allow_hosts: str | None, max_bytes: int | None = None):
    """按给定环境变量重新加载 ocr_core（该模块在导入期读取环境变量）。"""
    if allow_hosts is None:
        monkeypatch.delenv("OCR_URL_ALLOW_HOSTS", raising=False)
    else:
        monkeypatch.setenv("OCR_URL_ALLOW_HOSTS", allow_hosts)
    if max_bytes is not None:
        monkeypatch.setenv("OCR_MAX_BYTES", str(max_bytes))

    import ocr_core

    return importlib.reload(ocr_core)


def _transport(status: int, content):
    """构造只返回固定响应的 MockTransport（不产生真实网络请求）。"""
    return httpx.MockTransport(
        lambda request: httpx.Response(status, content=content)
    )


# ---------- 白名单校验 ----------


def test_default_allowlist_is_empty_and_denies_everything(monkeypatch):
    core = _load_core(monkeypatch, None)

    assert core.ALLOW_HOSTS == set()
    assert core.check_url("http://backend:3000/api/files/raw") is not None


def test_allowed_host_passes(monkeypatch):
    core = _load_core(monkeypatch, "backend")

    assert core.check_url("http://backend:3000/api/files/raw?u=admin") is None


def test_host_match_is_case_insensitive(monkeypatch):
    core = _load_core(monkeypatch, "Backend")

    assert core.check_url("http://BACKEND:3000/x") is None


def test_allowlist_parses_multiple_hosts_and_trims_whitespace(monkeypatch):
    core = _load_core(monkeypatch, " backend , gateway ")

    assert core.ALLOW_HOSTS == {"backend", "gateway"}


def test_unknown_host_is_rejected_with_config_hint(monkeypatch):
    core = _load_core(monkeypatch, "backend")

    message = core.check_url("http://evil:3000/x")

    assert message is not None
    assert "OCR_URL_ALLOW_HOSTS" in message


@pytest.mark.parametrize("url", ["", "not-a-url", "ftp://backend/x", "file:///etc/passwd"])
def test_non_http_urls_are_rejected(monkeypatch, url):
    core = _load_core(monkeypatch, "backend")

    assert core.check_url(url) is not None


# ---------- 受限下载 ----------


def test_download_returns_bytes_on_200(monkeypatch):
    core = _load_core(monkeypatch, "backend", max_bytes=1024)

    result = core.download("http://backend:3000/x", transport=_transport(200, b"abc"))

    assert result == b"abc"


def test_download_reports_expired_signature_on_non_200(monkeypatch):
    core = _load_core(monkeypatch, "backend", max_bytes=1024)

    result = core.download("http://backend:3000/x", transport=_transport(403, b""))

    assert isinstance(result, str)
    assert "签名可能已过期" in result


def test_download_rejects_oversized_body_by_content_length(monkeypatch):
    core = _load_core(monkeypatch, "backend", max_bytes=10)

    result = core.download("http://backend:3000/x", transport=_transport(200, b"x" * 100))

    assert isinstance(result, str)
    assert "超过上限" in result


def test_download_rejects_oversized_chunked_body(monkeypatch):
    """无 content-length（分块传输）时按累计字节拦截。"""
    core = _load_core(monkeypatch, "backend", max_bytes=10)
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, content=iter([b"x" * 8] * 3))
    )

    result = core.download("http://backend:3000/x", transport=transport)

    assert isinstance(result, str)
    assert "超过上限" in result
