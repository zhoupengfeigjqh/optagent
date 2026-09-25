"""OCR MCP 服务：RapidOCR（PaddleOCR 模型的 ONNX 版）+ FastMCP streamable-http。

对 Agent 暴露 ocr_image 工具：LLM 传 user-data 相对路径，backend 适配层
会把它铸成签名直链（image_url）发过来；本服务按 URL 回源下载后内存识别。

无共享存储依赖：可本地容器运行，也可远程部署。

分工：回源 URL 校验与受限下载在 ``ocr_core``（不依赖模型，可单测）；
本文件只做 MCP 工具装配与模型推理。
"""
import sys
import threading
from typing import Annotated

import cv2
import numpy as np
from mcp.server.fastmcp import FastMCP
from pydantic import Field
from rapidocr_onnxruntime import RapidOCR

from ocr_core import (
    ALLOW_HOSTS,
    accepted_payload,
    check_url,
    download,
    failed_result,
    make_job_id,
    post_result,
    result_filename,
    result_json,
    success_result,
    summary_of,
    with_filename,
)

mcp = FastMCP("ocr", host="0.0.0.0", port=8000)

# 进程级单例：模型常驻内存，避免每次调用重新加载
engine = RapidOCR()


@mcp.tool()
def ocr_image(
    image: Annotated[
        str,
        Field(description="要识别的图片：填文件空间相对路径（如 临时空间/a.png），backend 会自动铸成下载直链"),
    ],
    result_url: Annotated[
        str | None,
        Field(
            description=(
                "结果回写地址。**由平台自动注入，请勿自行填写**；"
                "留空（默认）时按同步方式直接返回识别结果（标准 JSON）"
            )
        ),
    ] = None,
) -> str:
    """识别图片中的文字。

    image：传用户消息 [引用文件] 中的相对路径（如 临时空间/a.png）即可，
    backend 会自动铸成下载直链发过来。图片不超过 2MB，支持 jpg/png/bmp/webp/tif。

    result_url：**请勿自行填写**——平台在把本工具声明为异步时会自动注入。
    收到它时本服务**立即返回受理**（含 job_id），识别在后台进行、完成后自动回写，
    结果会出现在后续对话里。留空时按同步方式直接返回识别结果（标准 JSON）。

    返回（同步返回与异步回写**同一形状**）：
    {"status":"success"|"failed","message":"一行说明或失败原因","text":"识别文本（失败时为空串）"}
    """
    if result_url:
        err = check_url(result_url)
        if err:
            # 回写地址不可信（模型幻觉 / 被篡改）：**忽略它并降级为同步**。
            # 不能"照样 POST"——那等于给任意主机发请求（SSRF）；也不能静默丢掉，
            # 否则调用方以为异步已受理却永远等不到结果。
            return f"{err}\n（回写地址不可用，已改为同步返回）\n{result_json(_recognize(image))}"
        job_id = make_job_id()
        threading.Thread(
            target=_recognize_and_post,
            args=(job_id, image, result_url),
            daemon=True,
        ).start()
        return accepted_payload(job_id)
    return result_json(_recognize(image))


def _recognize(image_url: str) -> dict[str, object]:
    """下载 + 识别；返回**标准 JSON 结果**（不抛异常——两条路径都要把它当作工具结果）。

    成功与失败是**同一形状**，只有 ``status`` 不同：失败原因在 ``message``、``text`` 为空串。
    """
    err = check_url(image_url)
    if err:
        return failed_result(err)
    data = download(image_url)
    if isinstance(data, str):
        return failed_result(data)
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return failed_result("错误：无法解码为图片（格式不支持或文件损坏）")
    result, _elapsed = engine(img)
    if not result:
        return failed_result("未识别到文字")
    # result: [[box, text, score], ...]，Agent 只需文本
    return success_result("\n".join(line[1] for line in result))


def _recognize_and_post(job_id: str, image_url: str, result_url: str) -> None:
    """后台线程体：识别 → 回写。

    失败**只记 stderr**：受理早就返回给模型了，这里没有第二条通道可回话；
    运行环境侧读不到结果时，用户看到的是"产出始终没出现"，日志是唯一线索。
    注意：这里说的"失败"是**回写动作**失败；**识别本身失败也会照常回写**（status=failed）。
    """
    result = _recognize(image_url)
    # 带一行摘要回写（契约 §10.3）：产出列表靠它区分"哪条是哪条"——
    # 否则一屏的 ocr__ocr_image 谁也认不出来
    err = post_result(with_filename(result_url, result_filename(job_id), summary_of(result)), result)
    if err:
        print(f"异步任务 {job_id} {err}", file=sys.stderr)


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
