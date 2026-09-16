"""OCR 服务的可测核心逻辑（不依赖 rapidocr / opencv）。

分层目的：把"回源 URL 校验（SSRF 白名单）+ 受限下载"这类纯逻辑与模型推理分开，
使单测不必加载 ONNX 模型、不必安装 opencv（在宿主机本地跑 `python -m pytest -q tests` 即可）。

server.py 负责 MCP 工具装配与识别；本模块只回答"能不能下、下多少"。
"""
import os
from urllib.parse import urlparse

import httpx

# 单张图片大小上限（默认 2MB，可经环境变量覆盖）：大图识别慢且收益低
MAX_BYTES = int(os.environ.get("OCR_MAX_BYTES", str(2 * 1024 * 1024)))

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
