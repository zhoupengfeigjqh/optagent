"""ocr_core 纯逻辑单测

运行方式（**宿主机本地**；宪章原则三：测试环境＝仅本地，容器 MUST NOT 承担测试职责）：
    cd ocr-service && pip install -r requirements-test.txt && python -m pytest -q tests

覆盖：白名单默认拒绝、命中放行、大小写与空白处理、scheme 校验，
以及下载的 HTTP 状态与大小上限（经 ``httpx.MockTransport`` 注入，不发真实请求）。
"""
import importlib
import json

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


# ---------- 异步工具（R11）：受理与结果回写 ----------


def test_make_job_id_has_prefixed_timestamp_and_random_suffix(monkeypatch):
    core = _load_core(monkeypatch, "backend")

    job_id = core.make_job_id(now=1_700_000_000.123)

    # 时间戳在前便于人眼排序；随机后缀防同毫秒碰撞
    assert job_id.startswith("ocr_1700000000123_")
    assert len(job_id.rsplit("_", 1)[-1]) == 8


def test_make_job_id_is_unique_within_same_millisecond(monkeypatch):
    core = _load_core(monkeypatch, "backend")

    ids = {core.make_job_id(now=1_700_000_000.0) for _ in range(50)}

    assert len(ids) == 50


def test_result_filename_uses_json_suffix(monkeypatch):
    core = _load_core(monkeypatch, "backend")

    assert core.result_filename("ocr_1_ab") == "ocr_1_ab.json"


def test_with_filename_preserves_existing_query(monkeypatch):
    """回写地址上的 u/d/exp/sig/sid 一个都不能丢（丢了就写不进、或写错地方）。"""
    core = _load_core(monkeypatch, "backend")
    url = (
        "http://backend:3000/api/files/put"
        "?u=admin&d=%E4%B8%B4%E6%97%B6%E7%A9%BA%E9%97%B4&exp=1&sig=abc&sid=th_1"
    )

    out = httpx.URL(core.with_filename(url, "ocr_1_ab.json"))

    assert out.params["u"] == "admin"
    assert out.params["d"] == "临时空间"  # 非 ASCII 参数原样解回
    assert out.params["sig"] == "abc"
    assert out.params["sid"] == "th_1"
    assert out.params["filename"] == "ocr_1_ab.json"


def test_with_filename_handles_url_without_query(monkeypatch):
    core = _load_core(monkeypatch, "backend")

    out = httpx.URL(core.with_filename("http://backend:3000/api/files/put", "a.txt"))

    assert out.params["filename"] == "a.txt"


def test_accepted_payload_is_json_and_tells_model_not_to_retry(monkeypatch):
    core = _load_core(monkeypatch, "backend")

    payload = json.loads(core.accepted_payload("ocr_1_ab"))

    assert payload["job_id"] == "ocr_1_ab"
    assert payload["status"] == "accepted"
    # 明确告知"无需重复提交"：模型若再提交一次，就是白算一遍
    assert "无需重复提交" in payload["message"]


def test_post_result_sends_utf8_json(monkeypatch):
    core = _load_core(monkeypatch, "backend")
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = request.content
        seen["ctype"] = request.headers.get("content-type")
        return httpx.Response(202)

    err = core.post_result(
        "http://backend:3000/api/files/put?u=admin",
        core.success_result("产能表\n冲压 1200"),
        transport=httpx.MockTransport(handler),
    )

    assert err is None
    assert str(seen["url"]).endswith("?u=admin")
    assert "application/json" in str(seen["ctype"])
    # 正文是**标准 JSON**：可被解析回同一形状，且中文不转义（人/模型直读）
    body = bytes(seen["body"]).decode("utf-8")
    assert "产能表" in body
    assert json.loads(body) == {
        "status": "success",
        "message": "识别到 2 行文字",
        "text": "产能表\n冲压 1200",
    }


def test_post_result_reports_non_2xx(monkeypatch):
    core = _load_core(monkeypatch, "backend")

    err = core.post_result(
        "http://backend:3000/x",
        core.success_result("t"),
        transport=_transport(403, b""),
    )

    assert err is not None
    assert "403" in err


def test_post_result_reports_transport_error(monkeypatch):
    """连接失败也要变成错误文案（后台线程里只能记日志，不能抛出去）。"""
    core = _load_core(monkeypatch, "backend")

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    err = core.post_result(
        "http://backend:3000/x",
        core.success_result("t"),
        transport=httpx.MockTransport(boom),
    )

    assert err is not None
    assert "ConnectError" in err


# ---------- 结果形状（标准 JSON）----------


def test_success_result_shape(monkeypatch):
    core = _load_core(monkeypatch, "backend")

    result = core.success_result("产能表\n冲压 1200\n")

    assert result["status"] == "success"
    assert result["message"] == "识别到 2 行文字"
    assert result["text"] == "产能表\n冲压 1200\n"


def test_failed_result_shape_has_empty_text(monkeypatch):
    """失败与成功**同一形状**，只是 status 不同、text 为空串。"""
    core = _load_core(monkeypatch, "backend")

    result = core.failed_result("未识别到文字")

    assert result == {"status": "failed", "message": "未识别到文字", "text": ""}


def test_result_json_is_readable_unicode(monkeypatch):
    core = _load_core(monkeypatch, "backend")

    text = core.result_json(core.success_result("产能表"))

    assert "产能表" in text  # 不转义成 \uXXXX，便于人/模型直读
    assert json.loads(text)["text"] == "产能表"


# ---------- 回写摘要（产出列表的可辨识度） ----------


def test_summary_of_uses_first_non_empty_line_on_success(monkeypatch):
    core = _load_core(monkeypatch, "backend")

    result = core.success_result("\n\n  产能表  \n冲压 1200\n")

    assert core.summary_of(result) == "产能表"


def test_summary_of_uses_message_on_failure(monkeypatch):
    """失败时摘要就是错误原因——标题上直接能看到"为什么没结果"。"""
    core = _load_core(monkeypatch, "backend")

    result = core.failed_result("错误：下载失败（HTTP 403），签名可能已过期")

    assert core.summary_of(result) == "错误：下载失败（HTTP 403），签名可能已过期"


def test_summary_of_falls_back_to_message_when_text_is_blank(monkeypatch):
    """成功但文本全空白（理论上不出现）→ 回落 message，**绝不留白**。"""
    core = _load_core(monkeypatch, "backend")

    result = {"status": "success", "message": "识别到 0 行文字", "text": "   \n\t\n"}

    assert core.summary_of(result) == "识别到 0 行文字"


def test_summary_of_truncates_to_limit(monkeypatch):
    core = _load_core(monkeypatch, "backend")

    result = core.success_result("甲" * (core.SUMMARY_MAX_CHARS + 50))

    assert len(core.summary_of(result)) == core.SUMMARY_MAX_CHARS


def test_with_filename_appends_summary_and_keeps_query(monkeypatch):
    core = _load_core(monkeypatch, "backend")
    url = "http://backend:3000/api/files/put?u=admin&sig=abc&sid=th_1"

    out = httpx.URL(core.with_filename(url, "ocr_1_ab.json", "产能表"))

    assert out.params["sig"] == "abc"
    assert out.params["sid"] == "th_1"
    assert out.params["filename"] == "ocr_1_ab.json"
    assert out.params["summary"] == "产能表"


def test_with_filename_omits_summary_when_absent(monkeypatch):
    """无摘要时**不写**该参数：运行环境把"缺省"与"空串"都视为无摘要，少传更干净。"""
    core = _load_core(monkeypatch, "backend")

    out = httpx.URL(core.with_filename("http://backend:3000/api/files/put?u=admin", "a.txt"))

    assert "summary" not in out.params
