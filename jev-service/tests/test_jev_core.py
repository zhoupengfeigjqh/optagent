"""jev_core 纯逻辑单测

运行方式（**宿主机本地**；宪章原则三：测试环境＝仅本地，容器 MUST NOT 承担测试职责）：
    cd jev-service && pip install -r requirements-test.txt && python -m pytest -q tests

覆盖：回源白名单（默认拒绝 / 命中放行 / 非 http 拒绝）、state 解析与**合并**
（纯文本、仅文件、两者合并、来源标注、编码回退、尺寸上限、未铸链诊断）、
三个 primitive 的请求体构造与取值域校验、响应格式化、错误映射与退避有界，
以及带重试调用的"该重试几次就几次 / 不该重试就一次都不多"。

全程经 ``httpx.MockTransport`` 注入桩，不发真实请求（真实调用会计费）。
"""
import importlib
import json

import httpx
import pytest

_ENV_KEYS = (
    "JEV_URL_ALLOW_HOSTS",
    "JEV_BASE_URL",
    "JEV_MODEL",
    "JEV_TIMEOUT_S",
    "JEV_MAX_RETRIES",
    "JEV_RETRY_BASE_S",
    "JEV_RETRY_MAX_S",
    "JEV_MAX_STATE_CHARS",
    "JEV_MAX_FILE_BYTES",
    "JEV_DOWNLOAD_TIMEOUT_S",
)

# backend 铸造的签名直链样本：p 是 URL 编码的 user-data 相对路径
SIGNED = (
    "http://backend:3000/api/files/raw"
    "?u=admin&p=%E4%B8%B4%E6%97%B6%E7%A9%BA%E9%97%B4%2F%E8%AE%A2%E5%8D%95.csv&exp=1&sig=abc"
)


def _load_core(monkeypatch, **env):
    """按给定环境变量重新加载 jev_core（该模块在导入期读取环境变量）。

    未显式给出的变量一律清空：每个用例的起点都是"干净缺省"，不受本机环境影响。
    """
    for key in _ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, str(value))

    import jev_core

    return importlib.reload(jev_core)


def _transport(status: int, content: bytes):
    """只返回固定响应的 MockTransport（用于引用文件回源）。"""
    return httpx.MockTransport(lambda request: httpx.Response(status, content=content))


class _Sleeps(list):
    """记录等待时长、但不真的等待（让"重试有界"可被断言）。"""

    def __call__(self, seconds):
        self.append(seconds)


def _answer_payload(**answer):
    return {
        "model": "jev-1.13.0",
        "answers": {"result": answer},
        "usage": {"input_tokens": 10, "output_tokens": 2},
    }


def _sequence_transport(statuses, body: bytes = b"{}", seen: list | None = None):
    """按顺序返回状态码；用尽后重复最后一个（用于重试用例）。"""
    queue = list(statuses)

    def handler(request):
        if seen is not None:
            seen.append(request)
        status = queue[0] if len(queue) == 1 else queue.pop(0)
        return httpx.Response(status, content=body)

    return httpx.MockTransport(handler)


# ---------- 回源白名单 ----------


def test_default_allowlist_is_empty_and_denies_everything(monkeypatch):
    core = _load_core(monkeypatch)

    assert core.ALLOW_HOSTS == set()
    assert core.check_url("http://backend:3000/api/files/raw") is not None


def test_allowed_host_passes_and_match_is_case_insensitive(monkeypatch):
    core = _load_core(monkeypatch, JEV_URL_ALLOW_HOSTS=" Backend , gateway ")

    assert core.check_url("http://BACKEND:3000/api/files/raw") is None
    assert core.check_url("http://gateway/x") is None


def test_non_http_scheme_is_rejected(monkeypatch):
    core = _load_core(monkeypatch, JEV_URL_ALLOW_HOSTS="backend")

    assert core.check_url("file:///etc/passwd") is not None


# ---------- 来源标注 ----------


def test_source_label_reads_relpath_from_signed_url(monkeypatch):
    core = _load_core(monkeypatch)

    assert core.source_label(SIGNED) == "临时空间/订单.csv"


def test_source_label_falls_back_to_last_path_segment(monkeypatch):
    core = _load_core(monkeypatch)

    assert core.source_label("http://host/files/a.txt") == "a.txt"
    # `raw` 是端点名而非文件名，不应被当成来源标注
    assert core.source_label("http://backend:3000/api/files/raw") is None


# ---------- state 合并 ----------


def test_merge_state_text_only(monkeypatch):
    core = _load_core(monkeypatch)

    assert core.merge_state("  客户投诉三次  ") == "客户投诉三次"


def test_merge_state_file_only(monkeypatch):
    core = _load_core(monkeypatch)

    merged = core.merge_state("", "订单.csv", "序号,金额")

    assert merged == "【引用文件：订单.csv】\n序号,金额"


def test_merge_state_puts_text_before_file(monkeypatch):
    core = _load_core(monkeypatch)

    merged = core.merge_state("客户投诉三次", "订单.csv", "序号,金额\n1,100")

    assert merged == "客户投诉三次\n\n【引用文件：订单.csv】\n序号,金额\n1,100"


def test_merge_state_without_label_uses_plain_header(monkeypatch):
    core = _load_core(monkeypatch)

    assert core.merge_state("", None, "内容").startswith("【引用文件】\n")


def test_merge_state_without_any_content_raises(monkeypatch):
    core = _load_core(monkeypatch)

    with pytest.raises(core.JevError) as err:
        core.merge_state("   ", None, "   ")

    assert "未提供待判断内容" in str(err.value)


# ---------- state 解析（文本 + 文件合并）----------


def test_resolve_state_merges_text_and_file(monkeypatch):
    core = _load_core(monkeypatch, JEV_URL_ALLOW_HOSTS="backend")

    out = core.resolve_state(
        "客户投诉三次", SIGNED, transport=_transport(200, "序号,金额\n1,100".encode())
    )

    assert out.startswith("客户投诉三次")
    assert "【引用文件：临时空间/订单.csv】" in out
    assert out.endswith("序号,金额\n1,100")


def test_resolve_state_file_only(monkeypatch):
    core = _load_core(monkeypatch, JEV_URL_ALLOW_HOSTS="backend")

    out = core.resolve_state("", SIGNED, transport=_transport(200, "内容".encode()))

    assert out == "【引用文件：临时空间/订单.csv】\n内容"


def test_resolve_state_rejects_blank_file_without_text(monkeypatch):
    """空白文件 + 无文本 = 没有可判断的内容：报错，而不是拼出一个只剩标题的空壳分节。"""
    core = _load_core(monkeypatch, JEV_URL_ALLOW_HOSTS="backend")

    with pytest.raises(core.JevError) as err:
        core.resolve_state("", SIGNED, transport=_transport(200, b"   \n  "))

    assert "内容为空" in str(err.value)


def test_resolve_state_drops_blank_file_section_when_text_given(monkeypatch):
    core = _load_core(monkeypatch, JEV_URL_ALLOW_HOSTS="backend")

    out = core.resolve_state("客户投诉", SIGNED, transport=_transport(200, b"  \n"))

    assert out == "客户投诉"
    assert "【引用文件" not in out


def test_resolve_state_rejects_relative_path_in_state_file(monkeypatch):
    """未铸链的诊断：收到相对路径说明平台侧 file_args 没声明（可操作提示，而非泛泛报错）。"""
    core = _load_core(monkeypatch, JEV_URL_ALLOW_HOSTS="backend")

    with pytest.raises(core.JevError) as err:
        core.resolve_state("文本", "临时空间/订单.csv")

    assert "file_args" in str(err.value)


def test_resolve_state_rejects_unauthorized_host(monkeypatch):
    core = _load_core(monkeypatch, JEV_URL_ALLOW_HOSTS="backend")

    with pytest.raises(core.JevError) as err:
        core.resolve_state("", "http://evil.local/api/files/raw?p=a.csv")

    assert "不在允许名单" in str(err.value)


def test_resolve_state_reports_download_failure(monkeypatch):
    core = _load_core(monkeypatch, JEV_URL_ALLOW_HOSTS="backend")

    with pytest.raises(core.JevError) as err:
        core.resolve_state("", SIGNED, transport=_transport(403, b"denied"))

    assert err.value.status == 403
    assert "签名可能已过期" in str(err.value)


def test_resolve_state_decodes_gbk_file(monkeypatch):
    core = _load_core(monkeypatch, JEV_URL_ALLOW_HOSTS="backend")

    out = core.resolve_state("", SIGNED, transport=_transport(200, "客户投诉".encode("gbk")))

    assert "客户投诉" in out


def test_resolve_state_rejects_undecodable_file(monkeypatch):
    core = _load_core(monkeypatch, JEV_URL_ALLOW_HOSTS="backend")

    with pytest.raises(core.JevError) as err:
        core.resolve_state("", SIGNED, transport=_transport(200, b"\xff\xff\xff"))

    assert "无法按文本解码" in str(err.value)


def test_resolve_state_rejects_oversized_file(monkeypatch):
    core = _load_core(monkeypatch, JEV_URL_ALLOW_HOSTS="backend", JEV_MAX_FILE_BYTES=4)

    with pytest.raises(core.JevError) as err:
        core.resolve_state("", SIGNED, transport=_transport(200, b"12345"))

    assert "超过上限" in str(err.value)


def test_resolve_state_rejects_oversized_merged_state(monkeypatch):
    core = _load_core(monkeypatch, JEV_MAX_STATE_CHARS=5)

    with pytest.raises(core.JevError) as err:
        core.resolve_state("123456")

    assert "过长" in str(err.value)


def test_resolve_state_checks_size_after_merge(monkeypatch):
    """上限判据作用在**合并后**的 state 上，而不是只看文本部分。"""
    core = _load_core(
        monkeypatch, JEV_URL_ALLOW_HOSTS="backend", JEV_MAX_STATE_CHARS=20
    )

    with pytest.raises(core.JevError) as err:
        core.resolve_state("文本", SIGNED, transport=_transport(200, "很长的文件内容" * 5))

    assert "过长" in str(err.value)


# ---------- 请求体构造 ----------


def test_noul_question_minimal_omits_criteria(monkeypatch):
    core = _load_core(monkeypatch)

    assert core.noul_question("是否紧急") == {
        "type": "noul",
        "instructions": "是否紧急",
    }


def test_noul_question_with_criteria(monkeypatch):
    core = _load_core(monkeypatch)

    question = core.noul_question("是否紧急", "明确有时效要求", "未表达紧迫性")

    assert question["criteria"] == {"true": "明确有时效要求", "false": "未表达紧迫性"}


def test_questions_require_instructions(monkeypatch):
    core = _load_core(monkeypatch)

    with pytest.raises(core.JevError):
        core.noul_question("   ")
    with pytest.raises(core.JevError):
        core.choice_question("", [{"value": "a"}, {"value": "b"}])
    with pytest.raises(core.JevError):
        core.score_question("", ["低", "高"])


def test_choice_question_maps_options(monkeypatch):
    core = _load_core(monkeypatch)

    question = core.choice_question(
        "该归哪个团队",
        [{"value": "billing", "criteria": "账单与退款"}, {"value": "technical"}],
    )

    assert question["type"] == "choice"
    assert question["criteria"] == {"billing": "账单与退款", "technical": None}


def test_choice_question_rejects_bad_options(monkeypatch):
    core = _load_core(monkeypatch)

    with pytest.raises(core.JevError) as too_few:
        core.choice_question("问", [{"value": "only"}])
    assert "至少需要 2 个选项" in str(too_few.value)

    with pytest.raises(core.JevError) as duplicated:
        core.choice_question("问", [{"value": "a"}, {"value": "a"}])
    assert "重复" in str(duplicated.value)

    with pytest.raises(core.JevError) as missing_value:
        core.choice_question("问", [{"value": ""}, {"value": "b"}])
    assert "缺少 value" in str(missing_value.value)

    many = [{"value": f"v{i}"} for i in range(core.CHOICE_MAX_OPTIONS + 1)]
    with pytest.raises(core.JevError) as too_many:
        core.choice_question("问", many)
    assert "最多" in str(too_many.value)


def test_score_question_bounds_levels(monkeypatch):
    core = _load_core(monkeypatch)

    assert core.score_question("多不满", ["平静", "不满", "非常愤怒"])["criteria"] == [
        "平静",
        "不满",
        "非常愤怒",
    ]

    for bad in (["仅一级"], ["a"] * 11):
        with pytest.raises(core.JevError) as err:
            core.score_question("问", bad)
        assert "有序等级" in str(err.value)

    with pytest.raises(core.JevError) as empty:
        core.score_question("问", ["低", "  "])
    assert "不能为空" in str(empty.value)


def test_build_body_uses_single_question_key(monkeypatch):
    core = _load_core(monkeypatch, JEV_MODEL="jev-test")

    body = core.build_body("状态", core.noul_question("是否紧急"))

    assert body["state"] == "状态"
    assert body["model"] == "jev-test"
    assert list(body["questions"]) == [core.QUESTION_KEY]


# ---------- 响应格式化 ----------


def test_format_noul_answer(monkeypatch):
    core = _load_core(monkeypatch)

    out = core.format_answer("noul", _answer_payload(type="noul", noul=0.95))

    assert json.loads(out) == {"type": "noul", "noul": 0.95}


def test_format_choice_answer(monkeypatch):
    core = _load_core(monkeypatch)

    out = core.format_answer(
        "choice",
        _answer_payload(
            type="choice",
            choice="billing",
            confidence=0.81,
            probabilities={"billing": 0.88, "technical": 0.12},
        ),
    )

    assert json.loads(out) == {
        "type": "choice",
        "choice": "billing",
        "confidence": 0.81,
        "probabilities": {"billing": 0.88, "technical": 0.12},
    }


def test_format_score_answer(monkeypatch):
    core = _load_core(monkeypatch)

    out = core.format_answer(
        "score",
        _answer_payload(
            type="score",
            score=1.05,
            confidence=0.92,
            legend={"0": "平静", "1": "不满", "2": "非常愤怒"},
            probabilities={"1": 0.95, "2": 0.05},
        ),
    )

    parsed = json.loads(out)
    assert parsed["type"] == "score"
    assert parsed["score"] == 1.05
    assert parsed["legend"]["2"] == "非常愤怒"


def test_format_answer_rejects_unexpected_payloads(monkeypatch):
    core = _load_core(monkeypatch)

    with pytest.raises(core.JevError):
        core.format_answer("noul", {"answers": {}})
    with pytest.raises(core.JevError):
        core.format_answer("noul", "not-a-dict")
    with pytest.raises(core.JevError):
        core.format_answer("noul", _answer_payload(type="noul", noul="0.95"))
    with pytest.raises(core.JevError) as unknown:
        core.format_answer("choice", _answer_payload(type="choice", choice="a"))
    assert "未知" not in str(unknown.value)


def test_usage_of_returns_tokens(monkeypatch):
    core = _load_core(monkeypatch)

    assert core.usage_of(_answer_payload(type="noul", noul=1))["input_tokens"] == 10
    assert core.usage_of({"answers": {}}) == {}


# ---------- 错误映射与退避 ----------


def test_map_error_covers_documented_statuses(monkeypatch):
    core = _load_core(monkeypatch)

    assert "TYPESAFE_API_KEY" in core.map_error(401)
    assert "入参校验失败" in core.map_error(422, '{"error":"questions required"}')
    assert "限流" in core.map_error(429)
    assert "过载" in core.map_error(529)
    assert "HTTP 503" in core.map_error(503)


def test_map_error_appends_summary_and_retry_count(monkeypatch):
    core = _load_core(monkeypatch)

    message = core.map_error(429, "rate\n  limited", retried=2)

    assert "rate limited" in message
    assert "已重试 2 次" in message


def test_summarize_is_single_line_and_truncated(monkeypatch):
    core = _load_core(monkeypatch)

    assert core.summarize("a\n  b") == "a b"
    assert core.summarize("x" * 300).endswith("…")


def test_should_retry_only_transient_statuses(monkeypatch):
    core = _load_core(monkeypatch)

    assert core.should_retry(429) and core.should_retry(529) and core.should_retry(503)
    assert not core.should_retry(401)
    assert not core.should_retry(422)
    assert not core.should_retry(200)


def test_backoff_delay_is_exponential_and_bounded(monkeypatch):
    core = _load_core(monkeypatch, JEV_RETRY_BASE_S=1, JEV_RETRY_MAX_S=4)

    assert [core.backoff_delay(i) for i in range(5)] == [1, 2, 4, 4, 4]


# ---------- 带重试调用 ----------


def test_post_sends_bearer_header_and_body(monkeypatch):
    core = _load_core(monkeypatch)
    seen: list = []
    transport = httpx.MockTransport(
        lambda request: (seen.append(request), httpx.Response(200, json=_answer_payload(type="noul", noul=0.95)))[1]
    )

    payload = core.post_with_retry(
        {"state": "s", "model": "m", "questions": {}},
        api_key="k1",
        transport=transport,
        sleep=_Sleeps(),
    )

    assert payload["answers"]["result"]["noul"] == 0.95
    assert seen[0].headers["authorization"] == "Bearer k1"
    assert json.loads(seen[0].content)["state"] == "s"


def test_post_retries_on_429_then_succeeds(monkeypatch):
    core = _load_core(monkeypatch)
    sleeps = _Sleeps()
    seen: list = []
    transport = _sequence_transport([429, 200], body=json.dumps(_answer_payload(type="noul", noul=0.4)).encode(), seen=seen)

    payload = core.post_with_retry({}, api_key="k1", transport=transport, sleep=sleeps)

    assert payload["answers"]["result"]["noul"] == 0.4
    assert len(seen) == 2
    assert sleeps == [core.RETRY_BASE_S]


def test_post_exhausts_retries_with_bounded_wait(monkeypatch):
    core = _load_core(monkeypatch, JEV_MAX_RETRIES=2)
    sleeps = _Sleeps()
    seen: list = []
    transport = _sequence_transport([429], body=b'{"error":"rate limited"}', seen=seen)

    with pytest.raises(core.JevError) as err:
        core.post_with_retry({}, api_key="k1", transport=transport, sleep=sleeps)

    assert len(seen) == 3  # 1 次首发 + 2 次重试
    assert len(sleeps) == 2
    assert sum(sleeps) <= 2 * core.RETRY_MAX_S
    assert err.value.status == 429
    assert "已重试 2 次" in str(err.value)
    assert "rate limited" in (err.value.body or "")


def test_post_does_not_retry_deterministic_failure(monkeypatch):
    core = _load_core(monkeypatch)
    sleeps = _Sleeps()
    seen: list = []
    transport = _sequence_transport([401], body=b'{"error":"invalid key"}', seen=seen)

    with pytest.raises(core.JevError) as err:
        core.post_with_retry({}, api_key="bad", transport=transport, sleep=sleeps)

    assert len(seen) == 1
    assert sleeps == []
    assert err.value.status == 401


def test_post_retries_transport_error_then_reports_bounded_failure(monkeypatch):
    core = _load_core(monkeypatch, JEV_MAX_RETRIES=1)
    sleeps = _Sleeps()

    def handler(request):
        raise httpx.ConnectError("connection refused")

    with pytest.raises(core.JevError) as err:
        core.post_with_retry(
            {}, api_key="k1", transport=httpx.MockTransport(handler), sleep=sleeps
        )

    assert sleeps == [core.RETRY_BASE_S]
    assert "已重试 1 次" in str(err.value)
    assert "ConnectError" in (err.value.body or "")


def test_post_without_api_key_fails_without_any_request(monkeypatch):
    core = _load_core(monkeypatch)
    seen: list = []
    transport = _sequence_transport([200], seen=seen)

    with pytest.raises(core.JevError) as err:
        core.post_with_retry({}, api_key="", transport=transport, sleep=_Sleeps())

    assert seen == []
    assert "TYPESAFE_API_KEY" in str(err.value)


def test_post_rejects_non_json_response(monkeypatch):
    core = _load_core(monkeypatch)

    with pytest.raises(core.JevError) as err:
        core.post_with_retry(
            {}, api_key="k1", transport=_transport(200, b"<html>oops</html>"), sleep=_Sleeps()
        )

    assert "不是合法 JSON" in str(err.value)
