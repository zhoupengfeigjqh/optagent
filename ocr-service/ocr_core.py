"""OCR 服务的可测核心逻辑（不依赖 rapidocr / opencv）。

分层目的：把"回源 URL 校验（SSRF 白名单）+ 受限下载"这类纯逻辑与模型推理分开，
使单测不必加载 ONNX 模型、不必安装 opencv（在宿主机本地跑 `python -m pytest -q tests` 即可）。

server.py 负责 MCP 工具装配与识别；本模块只回答"能不能下、下多少"。
"""
import json
import os
import time
import uuid
from collections.abc import Mapping
from urllib.parse import parse_qsl, urlencode, urlparse, urlsplit, urlunsplit

import httpx

# 单张图片大小上限（默认 2MB，可经环境变量覆盖）：大图识别慢且收益低
MAX_BYTES = int(os.environ.get("OCR_MAX_BYTES", str(2 * 1024 * 1024)))

# 结果回写的超时（秒）。与下载分开配置：回写发生在"算完之后"，语义与失败面都不同
UPLOAD_TIMEOUT = float(os.environ.get("OCR_UPLOAD_TIMEOUT_S", "10"))

# 识别结果的落盘扩展名（**标准 JSON**；运行环境会再补 `{prefix}_` 前缀）
RESULT_SUFFIX = ".json"

# 回写摘要的一行长度上限（运行环境侧同样按 200 字符截断；此处先截好，少传多余字节）
SUMMARY_MAX_CHARS = 200

# 允许回源下载的 host 白名单（防 SSRF：服务会按入参发 HTTP 请求）
# 默认**空集 = 拒绝一切回源**：部署方 MUST 显式声明允许的主机名，
# 不把"服务名必须叫 backend"这类部署假设写死在服务代码的默认值里。
ALLOW_HOSTS = {
    h.strip().lower()
    for h in os.environ.get("OCR_URL_ALLOW_HOSTS", "").split(",")
    if h.strip()
}

# 回源下载超时（秒）
DOWNLOAD_TIMEOUT = float(os.environ.get("OCR_DOWNLOAD_TIMEOUT_S", "10"))


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
            "请在容器的 OCR_URL_ALLOW_HOSTS 中声明该主机"
        )
    # 解析为内网/回环 IP 的主名一律拒绝（白名单主机名除外，其解析结果可能是内网——属预期部署）
    return None


def download(url: str, transport: httpx.BaseTransport | None = None) -> bytes | str:
    """下载图片字节；失败返回错误文案（str）。

    不跟随重定向、限时、边下边判大小（先看 content-length，再累计实际字节）。

    :param transport: 仅供测试注入（如 ``httpx.MockTransport``），生产调用保持缺省。
    """
    try:
        # 显式构造 Client：`httpx.stream()` 不暴露 transport，测试无法注入桩
        with httpx.Client(
            timeout=DOWNLOAD_TIMEOUT,
            follow_redirects=False,
            transport=transport,
        ) as client:
            with client.stream("GET", url) as r:
                if r.status_code != 200:
                    return f"错误：下载失败（HTTP {r.status_code}），签名可能已过期"
                length = r.headers.get("content-length")
                if length and int(length) > MAX_BYTES:
                    return f"错误：图片超过上限 {MAX_BYTES // 1024 // 1024}MB，请压缩后重试"
                chunks: list[bytes] = []
                total = 0
                for chunk in r.iter_bytes(64 * 1024):
                    total += len(chunk)
                    if total > MAX_BYTES:
                        return f"错误：图片超过上限 {MAX_BYTES // 1024 // 1024}MB，请压缩后重试"
                    chunks.append(chunk)
                return b"".join(chunks)
    except httpx.HTTPError as e:
        return f"错误：下载失败（{e.__class__.__name__}）"


# ---------- 异步工具（R11）：受理与结果回写 ----------


def make_job_id(now: float | None = None) -> str:
    """生成任务号：``ocr_<毫秒时间戳>_<随机 8 位>``。

    时间戳在前便于人眼排序与排查；随机后缀防同一毫秒内的碰撞。
    :param now: 仅供测试注入固定时刻。
    """
    stamp = int((now if now is not None else time.time()) * 1000)
    return f"ocr_{stamp}_{uuid.uuid4().hex[:8]}"


def result_filename(job_id: str) -> str:
    """回写正文的文件名（运行环境会再补 ``{prefix}_`` 前缀）。"""
    return f"{job_id}{RESULT_SUFFIX}"


# ---------- 结果形状（标准 JSON）----------

#: 识别成功（拿到了可用文字）
RESULT_STATUS_SUCCESS = "success"
#: 未拿到可用结果（下载/解码失败、图片无文字、回源地址不可信等）
RESULT_STATUS_FAILED = "failed"


def success_result(text: str) -> dict[str, object]:
    """成功的识别结果（标准 JSON 形状）。

    ``message`` 是**给人看的一行结论**（行数），``text`` 才是识别正文——
    两者刻意分开：列表标题用 ``message``/首行，正文用 ``text``。
    """
    lines = [line for line in text.splitlines() if line.strip()]
    return {
        "status": RESULT_STATUS_SUCCESS,
        "message": f"识别到 {len(lines)} 行文字",
        "text": text,
    }


def failed_result(message: str) -> dict[str, object]:
    """失败的结果（标准 JSON 形状）：原因在 ``message``，``text`` 恒为**空串**。

    用**同一个形状**承载成败（而不是成功给文本、失败给一句话），调用方无需分支猜测。
    """
    return {"status": RESULT_STATUS_FAILED, "message": message, "text": ""}


def summary_of(result: Mapping[str, object]) -> str:
    """从结果提炼**一行摘要**（回写给产出列表用，面向人可读）。

    - 失败：直接用 ``message``（错误原因本身就是最该被看到的）
    - 成功：取识别文本的**首个非空行**（图片里的文字对用户最有辨识度）

    限长 ``SUMMARY_MAX_CHARS``。Python 的 ``str`` 切片按**码点**，不会切开代理对（emoji 安全）。
    """
    if result.get("status") != RESULT_STATUS_SUCCESS:
        return str(result.get("message") or "识别失败")[:SUMMARY_MAX_CHARS]
    text = str(result.get("text") or "")
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped[:SUMMARY_MAX_CHARS]
    return str(result.get("message") or "识别完成")[:SUMMARY_MAX_CHARS]


def with_filename(url: str, filename: str, summary: str | None = None) -> str:
    """在回写地址上追加 ``filename``（与可选的 ``summary``），**保留原有 query**
    （u/d/exp/sig/sid/call_id/tool 一个不丢）。

    不能直接字符串拼 ``&filename=``：URL 是否已有 query、是否以 ``?`` 结尾都要判，
    且服务原样回传的地址可能带 fragment。

    ``summary`` 缺省/空串时**不写入该参数**——运行环境把"缺省"与"空串"同样视为无摘要，
    但少传一个空参数更干净（也让"服务到底提没提供摘要"在日志里一眼可辨）。
    """
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["filename"] = filename
    if summary:
        query["summary"] = summary
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def accepted_payload(job_id: str) -> str:
    """异步受理响应（**立即返回**给模型）。

    刻意返回 JSON 文本而不是纯自然语言：模型需要 ``job_id`` 才能在同一轮里
    向用户复述"任务号是多少"，排查时也要靠它定位。
    """
    return json.dumps(
        {
            "job_id": job_id,
            "status": "accepted",
            "message": "已受理，正在后台识别；完成后结果会自动出现在后续对话里，无需重复提交。",
        },
        ensure_ascii=False,
    )


def result_json(result: Mapping[str, object]) -> str:
    """结果的**标准 JSON 文本**（同步返回与异步回写**同一份形状**）。

    不转义非 ASCII：中文识别结果直接可读，也少传多余字节。
    """
    return json.dumps(result, ensure_ascii=False)


def post_result(
    url: str,
    result: Mapping[str, object],
    transport: httpx.BaseTransport | None = None,
) -> str | None:
    """把结果（**标准 JSON**）回写到 ``url``（运行环境的签名**写**直链）。

    成功返回 ``None``，失败返回**错误文案**（与 ``download`` 同一风格：不抛异常，
    由调用方决定怎么记——这里是后台线程，只能写日志）。

    content-type 为 ``application/json``：运行环境按"原样存"落盘（不解析，§10.3），
    该头只说明正文形态，便于人和模型读到时认出这是结构化结果。

    :param transport: 仅供测试注入（如 ``httpx.MockTransport``），生产调用保持缺省。
    """
    try:
        with httpx.Client(
            timeout=UPLOAD_TIMEOUT,
            follow_redirects=False,
            transport=transport,
        ) as client:
            r = client.post(
                url,
                content=result_json(result).encode("utf-8"),
                headers={"content-type": "application/json; charset=utf-8"},
            )
            if r.status_code not in (200, 202):
                return f"回写失败（HTTP {r.status_code}）"
            return None
    except httpx.HTTPError as e:
        return f"回写失败（{e.__class__.__name__}）"
