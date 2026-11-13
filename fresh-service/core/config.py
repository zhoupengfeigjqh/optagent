"""
集中配置：匹配阈值、服务参数、数据文件名等，均可用环境变量覆盖。
设计原则：核心逻辑（core/）只通过本模块读取配置，业务代码中不出现魔法数字。
"""
from __future__ import annotations
import os
from pathlib import Path

# 项目根目录（core/ 的上一级）
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# ---------- 匹配分流阈值 ----------
# score >= T_HIGH 高度匹配
# T_LOW <= score < T_HIGH 候选审核
# score < T_LOW（或 None）异常记录
T_HIGH = float(os.getenv("T_HIGH", "80.0"))
T_LOW = float(os.getenv("T_LOW", "30.0"))
# 候选审核时返回的候选数量，取置信分最高的前N项
TOP_N = int(os.getenv("TOP_N", "5"))

# ---------- 商品数据文件 ----------
# 单文件（三合一，向后兼容）
DEFAULT_PRODUCT_DATA_PATH = os.getenv(
    "DEFAULT_PRODUCT_DATA_PATH", str(PROJECT_ROOT / "商品数据.xlsx")
)
# 三个独立文件（fresh_order_parse 使用，各一个 sheet）
DEFAULT_SKU_PATH = os.getenv("DEFAULT_SKU_PATH", str(PROJECT_ROOT / "SKU清单.xlsx"))
DEFAULT_SYNONYMS_PATH = os.getenv("DEFAULT_SYNONYMS_PATH", str(PROJECT_ROOT / "映射表.xlsx"))
DEFAULT_NOISE_PATH = os.getenv("DEFAULT_NOISE_PATH", str(PROJECT_ROOT / "噪声词表.xlsx"))

# 三个工作表的表名（输入 Excel）
SHEET_SKU = os.getenv("SHEET_SKU", "SKU清单")
SHEET_SYNONYMS = os.getenv("SHEET_SYNONYMS", "映射表")
SHEET_NOISE = os.getenv("SHEET_NOISE", "噪声词表")

# 输出 Excel 的工作表名
SHEET_AUTO = "高度匹配"
SHEET_APPROVED = "审核通过"
SHEET_REVIEW = "候选审核"
SHEET_ERROR = "异常记录"

# 输出文件名
COMBINED_FILENAME = "订单识别结果.xlsx"
FILE_AUTO = f"{SHEET_AUTO}.xlsx"
FILE_APPROVED = f"{SHEET_APPROVED}.xlsx"
FILE_REVIEW = f"{SHEET_REVIEW}.xlsx"
FILE_ERROR = f"{SHEET_ERROR}.xlsx"

# ---------- 服务（FastMCP） ----------
MCP_HOST = os.getenv("MCP_HOST", "0.0.0.0")
MCP_PORT = int(os.getenv("MCP_PORT", "8000"))
MCP_NAME = os.getenv("MCP_NAME", "fresh_food_mcp_v1")
MCP_PATH = os.getenv("MCP_PATH", "/mcp")

# ---------- 网络 ----------
HTTP_TIMEOUT_SECONDS = float(os.getenv("HTTP_TIMEOUT_SECONDS", "30"))

# ---------- 商品数据表缓存 ----------
# 三个 xlsx 地址（URL）解析结果在进程内缓存，TTL 秒；设为 0 关闭缓存
DATA_CACHE_TTL_SECONDS = float(os.getenv("DATA_CACHE_TTL_SECONDS", "300"))
# 最多缓存多少组地址组合（LRU 淘汰）
DATA_CACHE_MAX_ENTRIES = int(os.getenv("DATA_CACHE_MAX_ENTRIES", "8"))

# ---------- OCR（PP-OCRv6 small 模型） ----------
# v6 的模型命名为 PP-OCRv6_{medium|small|tiny}_{det|rec}
OCR_DET_MODEL = os.getenv("OCR_DET_MODEL", "PP-OCRv6_small_det")
OCR_REC_MODEL = os.getenv("OCR_REC_MODEL", "PP-OCRv6_small_rec")