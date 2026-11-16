"""
生鲜订货识别 MCP 服务（fresh_food_mcp_v1）。

单一工具 fresh_order_parse：四个入参（订单图片 + SKU清单 / 映射表 / 噪声词表），
一次完成「加载商品数据 → 图片 OCR 识别 → 标准化/匹配三档分流」，
**只返回三表 JSON 解析结果**（`auto_rows` / `review_rows` / `error_rows` 及计数）。

设计约定：
- 一次调用只处理一张图片订单（image_path 单值，不接收数组）；
- 四个文件入参对**模型**是文件空间相对路径（如 `临时空间/订单1.png`），平台按 `file_args`
  声明原位铸造成签名直链后发给本服务 ⇒ **服务实际收到的必须是 http/https 直链**，
  因此 _check_http_url 拒绝相对路径（收到相对路径＝平台侧漏配 file_args）；
- 解析结果始终以 JSON 返回；**不产出任何文件**（报告 / xlsx 交付已移除，
  需要可读报告时由数字人按技能文档自行写 HTML 到临时空间）；
- image_path、sku_path 必填；noise_path、synonyms_path 留空时用镜像内默认文件；
- 三个数据表地址的解析结果按 TTL 缓存在进程内（见 core/cache.py）。
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated
from urllib.parse import unquote, urlparse

from fastmcp import FastMCP
from pydantic import Field

from core import config
from core.data_loader import load_product_data_three
from core.pipeline import analyze_batch

mcp = FastMCP(config.MCP_NAME)


def _source_name(image_url: str) -> str:
    """取图片地址里的文件名作为三表「来源」列；地址里没有文件名时用固定值。"""
    name = Path(unquote(urlparse(image_url).path)).name
    return name or "订单图片"


def _check_http_url(param: str, value: str) -> str:
    """校验服务**实际收到**的必须是 http/https 直链（模型侧填的是相对路径，由平台铸造）。

    模型/数字人看到的是相对路径（见各参数 description）；平台按 `file_args` 声明把相对路径
    原位换成签名直链再发给本服务。因此走到这里的值必须是 URL：
    仍是相对路径说明平台侧漏配 `file_args`，报错要能直接指向这一点。
    """
    url = (value or "").strip()
    scheme = urlparse(url).scheme.lower()
    if not url or scheme not in ("http", "https"):
        raise ValueError(
            f"{param} 需要平台铸造后的 http/https 下载直链（模型侧应填文件空间相对路径，"
            f"由平台 file_args 铸造）；当前值：{value!r}"
        )
    return url


# ---------------------------------------------------------------- 工具

@mcp.tool(title="生鲜订单解析")
def fresh_order_parse(
    image_path: Annotated[
        str,
        Field(
            title="订单图片",
            description="订单图片的文件空间相对路径（如 临时空间/订单1.png），平台会自动铸成下载直链；请勿自行填写 http 地址。必填，一次一张图",
        ),
    ],
    sku_path: Annotated[
        str,
        Field(
            title="SKU清单",
            description="SKU清单 xlsx 的文件空间相对路径（如 数据准备/商品/SKU清单.xlsx），平台会自动铸成下载直链；必填",
        ),
    ],
    noise_path: Annotated[
        str,
        Field(
            title="噪声词表",
            description="噪声词表 xlsx 的文件空间相对路径（平台铸成下载直链）；留空（推荐）时使用服务内置的默认噪声词表",
        ),
    ] = "",
    synonyms_path: Annotated[
        str,
        Field(
            title="映射表",
            description="映射表 xlsx 的文件空间相对路径（平台铸成下载直链）；留空（推荐）时使用服务内置的默认映射表",
        ),
    ] = "",
) -> dict:
    """
    解析一张生鲜订货单据图片，产出 SKU 匹配三表（高度匹配 / 候选审核 / 异常记录）。

    四个文件入参在工具声明里都是**文件空间相对路径**（如 `临时空间/订单1.png`）：
    平台按 `file_args` 声明把它们原位铸造成签名直链再发给本服务，模型不必、也不应填 http 地址。

    Args:
        image_path: 订单图片的文件空间相对路径（单张图片，必填）。
        sku_path: SKU清单 xlsx 的文件空间相对路径（必填）。
        noise_path: 噪声词表 xlsx 的相对路径（留空用服务内置默认表）。
        synonyms_path: 映射表 xlsx 的相对路径（留空用服务内置默认表）。

    返回 JSON（每行均带 order_no / source，**不含任何文件入口**）：
        auto_rows    —— 高度匹配行：raw_line、normalized_name、quantity、unit、
                        matched_name、sku_id、score 等
        review_rows  —— 候选审核行：raw_line、normalized_name、quantity、
                        top_score、candidates[{name, sku_id, score}] 等
        error_rows   —— 异常记录行：raw_line、error_type、top_candidate、
                        top_score、candidates、message 等
        auto_count / review_count / error_count —— 三表行数
    """
    image_url = _check_http_url("image_path", image_path)
    sku_url = _check_http_url("sku_path", sku_path)
    # 未必填的两个地址：传了就必须是合法 URL，留空则回落到镜像内默认文件
    noise_url = _check_http_url("noise_path", noise_path) if (noise_path or "").strip() else ""
    synonyms_url = (
        _check_http_url("synonyms_path", synonyms_path) if (synonyms_path or "").strip() else ""
    )

    data = load_product_data_three(sku_url, synonyms_url, noise_url)

    # 单张图片即一个订单：(来源, 文本, 图片地址)
    source_name = _source_name(image_url)
    orders = [(source_name, "", image_url)]
    auto, review, error = analyze_batch(orders, data)

    return {
        "auto_rows": auto, "auto_count": len(auto),
        "review_rows": review, "review_count": len(review),
        "error_rows": error, "error_count": len(error),
    }


if __name__ == "__main__":
    import uvicorn

    app = mcp.http_app(path=config.MCP_PATH, transport="streamable-http")

    print(f"[{config.MCP_NAME}] MCP 端点:  http://{config.MCP_HOST}:{config.MCP_PORT}{config.MCP_PATH}")
    uvicorn.run(app, host=config.MCP_HOST, port=config.MCP_PORT, log_level="info")
