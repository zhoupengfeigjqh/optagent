"""Jev 服务的可测核心逻辑（不依赖 MCP 框架、不发真实网络请求）。

分层目的（与 `ocr-service/ocr_core.py` 同一决策）：把
「入参校验 → state 解析与合并（纯文本／引用文件回源）→ 请求体构造 → 响应格式化 →
错误映射与退避策略」这些纯逻辑，与 MCP 工具装配、HTTP 客户端分离，
使单测在宿主机本地即可运行（`python -m pytest -q tests`）：
不必起服务，也不必真调 TypeSafe（真实调用会计费）。

`server.py` 只做三件事：装配 MCP 工具、把本模块的策略串起来、把结果或可读错误返回。
"""
import json
import os
import time
from collections.abc import Mapping
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import httpx

# ---------- 上游（TypeSafe Jev）----------
DEFAULT_BASE_URL = "https://api.typesafe.ai/v1/systemone"
# 端点整体可覆盖：便于指向官方网关（Vercel / OpenRouter / Cloudflare）或联调桩
BASE_URL = os.environ.get("JEV_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
MODEL = os.environ.get("JEV_MODEL", "jev-latest")

# ---------- 超时与重试（集中定义，便于单测断言"有界"）----------
REQUEST_TIMEOUT_S = float(os.environ.get("JEV_TIMEOUT_S", "20"))
MAX_RETRIES = int(os.environ.get("JEV_MAX_RETRIES", "3"))
RETRY_BASE_S = float(os.environ.get("JEV_RETRY_BASE_S", "0.5"))
RETRY_MAX_S = float(os.environ.get("JEV_RETRY_MAX_S", "8"))
# 可重试状态码：429 限流 / 529 过载（官方文档明示须指数退避）+ 常见瞬时 5xx
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504, 529})

# ---------- state 尺寸上限（防 token 成本失控）----------
MAX_STATE_CHARS = int(os.environ.get("JEV_MAX_STATE_CHARS", "200000"))
MAX_FILE_BYTES = int(os.environ.get("JEV_MAX_FILE_BYTES", str(512 * 1024)))

# ---------- 引用文件回源（与 ocr_core 同一 SSRF 判据）----------
# 默认**空集 = 拒绝一切回源**：部署方 MUST 显式声明允许的主机名，
# 不把"服务名必须叫 backend"这类部署假设写死进服务代码的默认值里。
ALLOW_HOSTS = {
    h.strip().lower()
    for h in os.environ.get("JEV_URL_ALLOW_HOSTS", "").split(",")
    if h.strip()
}
DOWNLOAD_TIMEOUT_S = float(os.environ.get("JEV_DOWNLOAD_TIMEOUT_S", "10"))

# ---------- primitive 取值域（官方 API reference）----------
CHOICE_MAX_OPTIONS = 255
SCORE_MIN_LEVELS = 2
SCORE_MAX_LEVELS = 10

# 请求里 questions 的键：由调用方自定义、随答案原样回传，不参与推理。三个工具共用一键。
QUESTION_KEY = "result"

# state 里引用文件的分隔标题（合并格式对 LLM 公开，见 server.py 的工具描述）
FILE_SECTION_PREFIX = "【引用文件"


class JevError(Exception):
    """面向用户的错误：``str(e)`` 即可读文案，可直接作为工具返回值。

    ``status`` / ``body`` 保留上游原始信息，供调用方落**结构化日志**
    （宪章原则九：降级对用户可感知，同时原始错误不得丢失）。
    """

    def __init__(self, message: str, *, status: int | None = None, body: str | None = None):
        super().__init__(message)
        self.status = status
        self.body = body


# ---------- 引用文件回源 ----------


def check_url(url: str) -> str | None:
    """校验回源地址；返回错误文案，``None`` 表示放行。"""
    try:
        u = urlparse(url)
    except Exception:
        return "错误：无效的 URL"
    if u.scheme not in ("http", "https"):
        return "错误：仅支持 http/https URL"
    host = (u.hostname or "").lower()
    if host not in ALLOW_HOSTS:
        allowed = ", ".join(sorted(ALLOW_HOSTS)) or "未配置任何允许主机"
        return (
            f"错误：URL 主机 {host or '(空)'} 不在允许名单（{allowed}）；"
            "请在容器的 JEV_URL_ALLOW_HOSTS 中声明该主机"
        )
    # 解析为内网/回环 IP 的主名一律拒绝（白名单主机名除外，其解析结果可能是内网——属预期部署）
    return None


def source_label(url: str, limit: int = 120) -> str | None:
    """从回源 URL 取"来源"标注，用于 state 合并时的分节标题。

    backend 的签名直链形如 `.../api/files/raw?u=&p=&exp=&sig=`，``p`` 即 user-data
    相对路径（如 `临时空间/订单.csv`）——比 URL 末段（恒为 `raw`）有信息量得多。
    取不到就返回 ``None``（仅影响标注，不影响下载）。
    """
    try:
        u = urlparse(url)
        rel_path = (parse_qs(u.query).get("p") or [""])[0].strip()
        if rel_path:
            return unquote(rel_path)[:limit]
        name = unquote(u.path.rsplit("/", 1)[-1])
        return name[:limit] if name and name != "raw" else None
    except Exception:
        return None


def download(url: str, transport: httpx.BaseTransport | None = None) -> bytes:
    """下载引用文件字节；失败抛 `JevError`（可读文案）。

    不跟随重定向、限时、边下边判大小（先看 content-length，再累计实际字节）。

    :param transport: 仅供测试注入（如 ``httpx.MockTransport``），生产调用保持缺省。
    """
    try:
        # 显式构造 Client：``httpx.stream()`` 不暴露 transport，测试无法注入桩
        with httpx.Client(
            timeout=DOWNLOAD_TIMEOUT_S,
            follow_redirects=False,
            transport=transport,
        ) as client:
            with client.stream("GET", url) as r:
                if r.status_code != 200:
                    raise JevError(
                        f"错误：读取引用文件失败（HTTP {r.status_code}），签名可能已过期",
                        status=r.status_code,
                    )
                length = r.headers.get("content-length") or ""
                if length.isdigit() and int(length) > MAX_FILE_BYTES:
                    raise JevError(_too_large_message())
                chunks: list[bytes] = []
                total = 0
                for chunk in r.iter_bytes(64 * 1024):
                    total += len(chunk)
                    if total > MAX_FILE_BYTES:
                        raise JevError(_too_large_message())
                    chunks.append(chunk)
                return b"".join(chunks)
    except httpx.HTTPError as e:
        raise JevError(
            f"错误：读取引用文件失败（{e.__class__.__name__}）", body=str(e)
        ) from e


def _too_large_message() -> str:
    return f"错误：引用文件超过上限 {MAX_FILE_BYTES // 1024}KB，请裁剪后重试"


def decode_text(data: bytes) -> str:
    """把引用文件字节解码成文本：UTF-8（含 BOM）优先，其次 GB18030（兼容 GBK/GB2312）。

    显式失败好过静默乱码——若全部解码失败，给出可操作的提示而非把乱码喂给模型。
    """
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise JevError("错误：引用文件无法按文本解码（请另存为 UTF-8 后重试）")


def merge_state(text: str | None, label: str | None = None, file_text: str | None = None) -> str:
    """把 LLM 文本与引用文件内容**合并**成最终 state（不是二选一，两者可同时提供）。

    合并格式（同一形状在 server.py 的工具描述里向 LLM 公开）::

        <LLM 文本>

        【引用文件：临时空间/订单.csv】
        <文件内容>

    顺序刻意是"文本在前、文件在后"：LLM 的文本通常交代了判断意图与背景，
    文件是待对照的原始数据，先给意图再给数据更贴近 instructions 的写法定式。
    只给一侧时退化为该侧本身；两侧都空则报错。

    文件内容为空白（空文件/纯空白）时**不产生分节**——否则会拼出一个只剩标题的空壳，
    把"没有待判断内容"伪装成"有内容"。
    """
    parts: list[str] = []
    body = (text or "").strip()
    if body:
        parts.append(body)
    if file_text is not None and file_text.strip():
        header = f"{FILE_SECTION_PREFIX}：{label}】" if label else f"{FILE_SECTION_PREFIX}】"
        parts.append(f"{header}\n{file_text.strip()}")

    merged = "\n\n".join(parts).strip()
    if not merged:
        raise JevError(
            "错误：未提供待判断内容——请填 state（LLM 生成的文本）或 state_file（文件空间相对路径）"
        )
    if len(merged) > MAX_STATE_CHARS:
        raise JevError(
            f"错误：待判断内容过长（{len(merged)} 字符 > 上限 {MAX_STATE_CHARS}），请裁剪或分次判断"
        )
    return merged


def resolve_state(
    state: str | None,
    state_file: str | None = None,
    *,
    transport: httpx.BaseTransport | None = None,
) -> str:
    """解析工具入参 → 最终 state：文本部分直接采用，文件部分回源取内容后与前合并。

    ``state_file`` 期望是 backend 铸造的**下载直链**（由 `file_args` 声明换来）；
    若收到的是相对路径，说明平台侧没声明该文件参数——给出可操作的诊断而非泛泛报错。
    """
    file_ref = (state_file or "").strip()
    if file_ref and not file_ref.lower().startswith(("http://", "https://")):
        echoed = file_ref if len(file_ref) <= 60 else f"{file_ref[:60]}…"
        raise JevError(
            f"错误：state_file 收到的不是下载直链而是「{echoed}」——"
            "请检查平台侧该工具的 file_args 是否声明了 state_file: url"
        )

    if not file_ref:
        return merge_state(state)

    err = check_url(file_ref)
    if err:
        raise JevError(err)

    label = source_label(file_ref)
    file_text = decode_text(download(file_ref, transport=transport))
    if not file_text.strip() and not (state or "").strip():
        raise JevError(
            f"错误：引用文件（{label or '未命名'}）内容为空，且未提供 state 文本，没有可判断的内容"
        )
    return merge_state(state, label, file_text)


# ---------- 请求体构造（三个 primitive 一一对应）----------


def _require_instructions(instructions: str) -> str:
    text = (instructions or "").strip()
    if not text:
        raise JevError(
            "错误：instructions 不能为空——请用一句原子化的判断问题说明要 Jev 判断什么"
        )
    return text


def noul_question(
    instructions: str, true_meaning: str = "", false_meaning: str = ""
) -> dict[str, Any]:
    """真假命题（返回真值概率 0–1）。``criteria`` 仅在给了含义描述时写入。"""
    question: dict[str, Any] = {
        "type": "noul",
        "instructions": _require_instructions(instructions),
    }
    criteria: dict[str, str] = {}
    if true_meaning.strip():
        criteria["true"] = true_meaning.strip()
    if false_meaning.strip():
        criteria["false"] = false_meaning.strip()
    if criteria:
        question["criteria"] = criteria
    return question


def choice_question(instructions: str, options: list[Any] | None) -> dict[str, Any]:
    """单项选择（返回选中项 + 概率分布 + 置信度）。选项值不得重复。"""
    question: dict[str, Any] = {
        "type": "choice",
        "instructions": _require_instructions(instructions),
    }
    if not isinstance(options, list) or len(options) < 2:
        raise JevError("错误：choice 至少需要 2 个选项（每项含 value 与可选 criteria）")
    if len(options) > CHOICE_MAX_OPTIONS:
        raise JevError(
            f"错误：choice 选项最多 {CHOICE_MAX_OPTIONS} 个（本次 {len(options)} 个）"
        )

    criteria: dict[str, str | None] = {}
    for index, option in enumerate(options, start=1):
        if not isinstance(option, dict):
            raise JevError(f"错误：choice 的第 {index} 个选项应为对象（value / criteria）")
        value = str(option.get("value") or "").strip()
        if not value:
            raise JevError(f"错误：choice 的第 {index} 个选项缺少 value")
        if value in criteria:
            raise JevError(f"错误：choice 选项 value 重复：「{value}」")
        description = str(option.get("criteria") or "").strip()
        criteria[value] = description or None
    question["criteria"] = criteria
    return question


def score_question(instructions: str, levels: list[Any] | None) -> dict[str, Any]:
    """按量表打分（返回概率加权分值 + 等级表 + 置信度）。等级 2–10 级，从低到高。"""
    question: dict[str, Any] = {
        "type": "score",
        "instructions": _require_instructions(instructions),
    }
    count = len(levels) if isinstance(levels, list) else 0
    if not (SCORE_MIN_LEVELS <= count <= SCORE_MAX_LEVELS):
        raise JevError(
            f"错误：score 需要 {SCORE_MIN_LEVELS}–{SCORE_MAX_LEVELS} 个有序等级（本次 {count} 个）"
        )
    cleaned = [str(level).strip() for level in levels]  # type: ignore[union-attr]
    if any(not level for level in cleaned):
        raise JevError("错误：score 的等级描述不能为空")
    question["criteria"] = cleaned
    return question


def build_body(state: str, question: dict[str, Any], *, model: str = MODEL) -> dict[str, Any]:
    """组装 Jev 请求体：同一 state 下多个问题会并行且相互隔离地求值（本期一次一问）。"""
    return {"state": state, "model": model, "questions": {QUESTION_KEY: question}}


# ---------- 响应格式化 ----------


def _number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise JevError(f"错误：Jev 返回体缺少数值字段「{field}」")
    return float(value)


def _plain_map(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


# ---------- 结果形状（标准 JSON）----------

#: 求值成功（拿到了结构化决策）
RESULT_STATUS_SUCCESS = "success"
#: 未拿到结果（入参校验失败、上游错误、重试耗尽等）
RESULT_STATUS_FAILED = "failed"


def failed_result(message: str) -> dict[str, Any]:
    """失败的结果（标准 JSON 形状）：原因在 ``message``。

    与成功结果**同一形状**（都有 ``status``）——调用方不必靠"是不是自然语言"来猜成败，
    也不必对两种返回值做分支处理。
    """
    return {"status": RESULT_STATUS_FAILED, "message": message}


def result_json(result: Mapping[str, Any]) -> str:
    """结果的**标准 JSON 文本**（工具返回口径与 `ocr-service` 一致）。

    不转义非 ASCII；用紧凑分隔符（工具结果会进对话上下文，少占 token）。
    """
    return json.dumps(result, ensure_ascii=False, separators=(",", ":"))


def format_answer(kind: str, payload: Any) -> dict[str, Any]:
    """把 Jev 返回体格式化成**结果对象**（标准 JSON 形状，恒带 ``status``）。

    只回传模型需要的取值；``model`` / ``usage`` 是成本观测信息，落日志即可，不占对话上下文。
    序列化统一交给 ``result_json``（与失败路径共用同一出口）。
    """
    if not isinstance(payload, dict):
        raise JevError("错误：Jev 返回体不是 JSON 对象")
    answers = payload.get("answers")
    answer = answers.get(QUESTION_KEY) if isinstance(answers, dict) else None
    if not isinstance(answer, dict):
        raise JevError(f"错误：Jev 返回体缺少「{QUESTION_KEY}」的结果")

    if kind == "noul":
        return {
            "status": RESULT_STATUS_SUCCESS,
            "type": "noul",
            "noul": _number(answer.get("noul"), "noul"),
        }
    if kind == "choice":
        return {
            "status": RESULT_STATUS_SUCCESS,
            "type": "choice",
            "choice": str(answer.get("choice") or ""),
            "confidence": _number(answer.get("confidence"), "confidence"),
            "probabilities": _plain_map(answer.get("probabilities")),
        }
    if kind == "score":
        return {
            "status": RESULT_STATUS_SUCCESS,
            "type": "score",
            "score": _number(answer.get("score"), "score"),
            "confidence": _number(answer.get("confidence"), "confidence"),
            "legend": _plain_map(answer.get("legend")),
            "probabilities": _plain_map(answer.get("probabilities")),
        }
    raise JevError(f"错误：未知的 primitive 类型「{kind}」")


def usage_of(payload: Any) -> dict[str, Any]:
    """取 token 用量（仅用于结构化日志）。"""
    usage = payload.get("usage") if isinstance(payload, dict) else None
    return dict(usage) if isinstance(usage, dict) else {}


# ---------- 错误映射与退避 ----------

_ERROR_HINTS: dict[int, str] = {
    401: "错误：TYPESAFE_API_KEY 缺失或无效（见 jev-service/.env.local）",
    422: "错误：Jev 拒绝了本次请求（入参校验失败）",
    429: "错误：Jev 触发限流（HTTP 429），请稍后重试",
    529: "错误：Jev 服务过载（HTTP 529），请稍后重试",
}


def summarize(body: str, limit: int = 200) -> str:
    """上游错误体的单行摘要：给用户看的可读片段（完整原文进结构化日志）。"""
    text = " ".join((body or "").split())
    return text[:limit] + ("…" if len(text) > limit else "")


def map_error(status: int, body: str = "", retried: int = 0) -> str:
    """HTTP 状态 → 用户可读文案（含上游摘要与已重试次数）。"""
    message = _ERROR_HINTS.get(status, f"错误：Jev 调用失败（HTTP {status}）")
    detail = summarize(body)
    if detail:
        message = f"{message}：{detail}"
    if retried > 0:
        message = f"{message}（已重试 {retried} 次）"
    return message


def should_retry(status: int) -> bool:
    return status in RETRY_STATUSES


def backoff_delay(attempt: int) -> float:
    """第 ``attempt`` 次重试前的等待秒数（attempt 从 0 起）：指数退避且**有上界**。

    上界 ``RETRY_MAX_S`` 保证总等待时间随重试次数线性封顶而非指数爆炸——
    降级路径 MUST 有界（宪章原则九）。
    """
    return min(RETRY_BASE_S * (2**attempt), RETRY_MAX_S)


# ---------- 带重试调用 ----------


def post_with_retry(
    body: dict[str, Any],
    *,
    api_key: str,
    transport: httpx.BaseTransport | None = None,
    sleep=time.sleep,
    base_url: str | None = None,
) -> dict[str, Any]:
    """向 Jev 端点发一次求值请求，按 ``RETRY_STATUSES`` 做**有界**指数退避重试。

    可重试的是"瞬时"失败（限流/过载/网络错误）；401/422 这类确定性失败**立即返回**，
    重试只是浪费时间与配额。

    :param transport: 仅供测试注入（如 ``httpx.MockTransport``）
    :param sleep: 仅供测试注入（默认 ``time.sleep``），使单测不必真的等待
    :raises JevError: 任何失败（``status`` / ``body`` 携带上游原始信息）
    """
    if not api_key:
        raise JevError(
            "错误：未配置 TYPESAFE_API_KEY（见 jev-service/.env.local），无法调用 Jev"
        )

    url = base_url or BASE_URL
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    with httpx.Client(
        timeout=REQUEST_TIMEOUT_S, follow_redirects=False, transport=transport
    ) as client:
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = client.post(url, headers=headers, json=body)
            except httpx.HTTPError as e:
                raw = f"{e.__class__.__name__}: {e}"
                if attempt < MAX_RETRIES:
                    sleep(backoff_delay(attempt))
                    continue
                raise JevError(
                    f"错误：无法连接 Jev（{e.__class__.__name__}），已重试 {MAX_RETRIES} 次", body=raw
                ) from e

            if response.status_code == 200:
                try:
                    payload = response.json()
                except ValueError as e:
                    raise JevError("错误：Jev 返回体不是合法 JSON", body=response.text) from e
                if not isinstance(payload, dict):
                    raise JevError("错误：Jev 返回体不是 JSON 对象", body=response.text)
                return payload

            if should_retry(response.status_code) and attempt < MAX_RETRIES:
                sleep(backoff_delay(attempt))
                continue
            raise JevError(
                map_error(response.status_code, response.text, retried=attempt),
                status=response.status_code,
                body=response.text,
            )

    raise JevError("错误：Jev 调用失败（重试循环异常结束）")  # 不可达兜底
