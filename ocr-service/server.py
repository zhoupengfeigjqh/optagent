"""OCR MCP 服务：RapidOCR（PaddleOCR 模型的 ONNX 版）+ FastMCP streamable-http。

对 Agent 暴露 ocr_image 工具：LLM 传 user-data 相对路径，backend 适配层
会把它铸成签名直链（image_url）发过来；本服务按 URL 回源下载后内存识别。

无共享存储依赖：可本地容器运行，也可远程部署。

分工：回源 URL 校验与受限下载在 ``ocr_core``（不依赖模型，可单测）；
本文件只做 MCP 工具装配与模型推理。
"""
import sys
from typing import Annotated

import cv2
import numpy as np
from mcp.server.fastmcp import FastMCP
from pydantic import Field
from rapidocr_onnxruntime import RapidOCR

from ocr_core import ALLOW_HOSTS, check_url, download

mcp = FastMCP("ocr", host="0.0.0.0", port=8000)

# 进程级单例：模型常驻内存，避免每次调用重新加载
engine = RapidOCR()


@mcp.tool()
def ocr_image(
    image: Annotated[
        str,
        Field(description="要识别的图片：填文件空间相对路径（如 临时空间/a.png），backend 会自动铸成下载直链"),
    ],
) -> str:
    """识别图片中的文字，返回按行拼接的文本。

    image：传用户消息 [引用文件] 中的相对路径（如 临时空间/a.png）即可，
    backend 会自动铸成下载直链发过来。图片不超过 2MB，支持 jpg/png/bmp/webp/tif。
    """
    err = check_url(image)
    if err:
        return err
    data = download(image)
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
    if not ALLOW_HOSTS:
        print(
            "警告：未配置 OCR_URL_ALLOW_HOSTS，OCR 将拒绝所有回源下载请求",
            file=sys.stderr,
        )
    print(
        f"OCR MCP 服务启动，允许回源主机：{', '.join(sorted(ALLOW_HOSTS)) or '（无）'}",
        file=sys.stderr,
    )
    mcp.run(transport="streamable-http")
