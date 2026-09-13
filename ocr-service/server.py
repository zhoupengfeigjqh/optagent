"""OCR MCP 服务：RapidOCR（PaddleOCR 模型的 ONNX 版）+ FastMCP streamable-http。

对 Agent 暴露 ocr_image 工具：LLM 传 user-data 相对路径，backend 适配层
会把它铸成签名直链（image_url）发过来；本服务按 URL 回源下载后内存识别。

无共享存储依赖：可本地容器运行，也可远程部署。
"""
import os
import sys
from urllib.parse import urlparse

import httpx
import numpy as np
import cv2
from mcp.server.fastmcp import FastMCP
from rapidocr_onnxruntime import RapidOCR

# 单张图片大小上限（默认 2MB，可经环境变量覆盖）：大图识别慢且收益低
MAX_BYTES = int(os.environ.get("OCR_MAX_BYTES", str(2 * 1024 * 1024)))

# 允许回源下载的 host 白名单（防 SSRF：服务会按入参发 HTTP 请求）
ALLOW_HOSTS = {
    h.strip().lower()
    for h in os.environ.get("OCR_URL_ALLOW_HOSTS", "backend").split(",")
    if h.strip()
}

DOWNLOAD_TIMEOUT = float(os.environ.get("OCR_DOWNLOAD_TIMEOUT_S", "10"))

mcp = FastMCP("ocr", host="0.0.0.0", port=8000)

# 进程级单例：模型常驻内存，避免每次调用重新加载
engine = RapidOCR()


def _check_url(url: str) -> str | None:
    """返回错误文案；None 表示放行。"""
    try:
        u = urlparse(url)
    except Exception:
        return "错误：无效的 URL"
    if u.scheme not in ("http", "https"):
        return "错误：仅支持 http/https URL"
    host = (u.hostname or "").lower()
    if host not in ALLOW_HOSTS:
        return f"错误：URL 主机 {host or '(空)'} 不在允许名单（{', '.join(sorted(ALLOW_HOSTS))}）"
    # 解析为内网/回环 IP 的主名一律拒绝（白名单主机名除外，其解析结果可能是内网——属预期部署）
    return None


def _download(url: str) -> bytes | str:
    """下载图片字节；失败返回错误文案（str）。"""
    try:
        with httpx.stream("GET", url, timeout=DOWNLOAD_TIMEOUT, follow_redirects=False) as r:
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


@mcp.tool()
def ocr_image(image: str) -> str:
    """识别图片中的文字，返回按行拼接的文本。

    image：传用户消息 [引用文件] 中的相对路径（如 tmp/a.png）即可，
    backend 会自动铸成下载直链发过来。图片不超过 2MB，支持 jpg/png/bmp/webp/tif。
    """
    err = _check_url(image)
    if err:
        return err
    data = _download(image)
    if isinstance(data, str):
        return data
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return "错误：无法解码为图片（格式不支持或文件损坏）"
    result, _elapsed = engine(img)
    if not result:
        return "未识别到文字"
    # result: [[box, text, score], ...]，Agent 只需文本
    return "\n".join(line[1] for line in result)


if __name__ == "__main__":
    print(f"OCR MCP 服务启动，允许回源主机：{sorted(ALLOW_HOSTS)}", file=sys.stderr)
    mcp.run(transport="streamable-http")
