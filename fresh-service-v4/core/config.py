"""
集中配置：匹配阈值、服务参数、数据文件名等，均可用环境变量覆盖。
设计原则：核心逻辑（core/）只通过本模块读取配置，业务代码中不出现魔法数字。
"""
from __future__ import annotations
import os
from pathlib import Path

# 项目根目录（core/ 的上一级）
PROJECT_ROOT = Path(__file__).resolve().parent.parent


#: 本进程从 .env / .env.local 注入过的变量（名 -> 值）：用于"文件之间可覆盖，
#: 但不覆盖真实进程环境变量"——只有当前值仍等于我们注入的值时，才允许被后一个文件覆盖。
_FILE_INJECTED: dict[str, str] = {}


#: 这些变量属于"API Key 槽位"：只要 .env/.env.local 里有**非空**值，就以文件为准
#: （覆盖系统/容器注入的同名变量）；文件里是空值则视为没设置，继续看系统环境变量。
KEY_ENV_NAMES: frozenset[str] = frozenset({
    "LLM_API_KEY", "DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "OPENAI_API_KEY",
})


def load_dotenv_local(path: Path | None = None, *, override_injected: bool = True) -> list[str]:
    """把 ``.env`` / ``.env.local`` 里的 ``KEY=VALUE`` 注入进程环境。

    规则（按优先级从高到低）：
    1. ``.env`` / ``.env.local`` 里的**API Key**（:`KEY_ENV_NAMES`，非空才生效）——
       方便"改 .env 就换 Key"，不用再改系统环境变量；
    2. 真实进程环境变量（系统/容器注入）——对**其它**变量永远优先；
    3. ``.env.local`` 可覆盖 ``.env`` 里的同名项；
    4. **空值一律忽略**（`LLM_API_KEY=` 这种空行等于没写，不会盖掉系统变量）。

    返回实际注入的变量名，便于自检/日志（**不返回值本身**）。
    """
    env_file = path or (PROJECT_ROOT / ".env")
    try:
        text = env_file.read_text(encoding="utf-8-sig")
    except OSError:
        return []
    injected: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not key or not value:                            # 空值 = 没设置，直接跳过
            continue
        current = os.environ.get(key)
        injected_value = _FILE_INJECTED.get(key)
        if current is not None and key not in KEY_ENV_NAMES and not (
            override_injected and injected_value is not None and current == injected_value
        ):
            continue                                        # 非 Key 变量：真实环境变量优先
        os.environ[key] = value
        _FILE_INJECTED[key] = value
        injected.append(key)
    return injected


def load_project_env_files(root: Path | None = None) -> list[str]:
    """按 ``.env`` → ``.env.local`` 顺序加载项目根的环境文件（后者覆盖前者）。"""
    base = root or PROJECT_ROOT
    injected: list[str] = []
    for name in (".env", ".env.local"):
        injected.extend(load_dotenv_local(base / name))
    return injected


# 先加载环境文件，再读下面的环境变量（顺序不能反）
load_project_env_files()


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
# 2026-11 起改用「编码」列 + 精简后的三张表；旧文件名（SKU清单/映射表/噪声词表）作为回退
def _first_existing(*names: str) -> str:
    for name in names:
        candidate = PROJECT_ROOT / name
        if candidate.exists():
            return str(candidate)
    return str(PROJECT_ROOT / names[0])


DEFAULT_SKU_PATH = os.getenv("DEFAULT_SKU_PATH", _first_existing("sku.xlsx", "SKU清单.xlsx"))
DEFAULT_SYNONYMS_PATH = os.getenv(
    "DEFAULT_SYNONYMS_PATH", _first_existing("map.xlsx", "映射表.xlsx")
)
DEFAULT_NOISE_PATH = os.getenv("DEFAULT_NOISE_PATH", _first_existing("noise.xlsx", "噪声词表.xlsx"))

# 三个工作表的表名（输入 Excel）
SHEET_SKU = os.getenv("SHEET_SKU", "SKU清单")
SHEET_SYNONYMS = os.getenv("SHEET_SYNONYMS", "映射表")
SHEET_NOISE = os.getenv("SHEET_NOISE", "噪声词表")

# 输出 Excel 的工作表名
SHEET_AUTO = "高度匹配"
SHEET_APPROVED = "审核通过"
SHEET_REVIEW = "候选审核"
SHEET_ERROR = "异常记录"
#: 交付工作簿里唯一可见的「拼接表」：三档按顺序合到一张，其余三张隐藏
SHEET_FINAL = "最终推荐"

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

# ---------- LLM 读图（手写单走 LLM，表格仍走 OCR） ----------
# ⚠️ **不要在这个文件里填真 Key**（会被提交、被打包、被整包发人）。
#    真 Key 放项目根的 `.env`（或 `.env.local`，后者可覆盖前者），由上面的
#    load_project_env_files() 自动读入；容器里则由 compose 的 env_file / -e 注入。
#    下面只保留一个占位符，用于"没配置时不要发请求"的判断。
#
# Key 的来源（按优先级从高到低，任一即可）：
#   1. 真实进程环境变量（系统变量 / docker -e / compose environment）
#   2. .env.local（本地覆盖，可覆盖 .env）
#   3. .env（**推荐放 Key 的地方**）
# 认的变量名（四个是业界事实约定，没有唯一官方名）：
#   LLM_API_KEY        本项目自定义（推荐，可配合任何网关）
#   DEEPSEEK_API_KEY   DeepSeek 官方约定
#   DASHSCOPE_API_KEY  阿里云百炼（DashScope）约定
#   OPENAI_API_KEY     OpenAI 及大多数"OpenAI 兼容"网关的通用约定
LLM_KEY_ENV_ORDER = ("LLM_API_KEY", "DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "OPENAI_API_KEY")

#: 没显式设 LLM_BASE_URL 时，按 Key 的来源推断默认端点
LLM_BASE_BY_KEY_ENV = {
    "DEEPSEEK_API_KEY": "https://api.deepseek.com/v1",
    "DASHSCOPE_API_KEY": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "OPENAI_API_KEY": "https://api.openai.com/v1",
}
LLM_BASE_DEFAULT = "https://api.deepseek.com/v1"
LLM_KEY_PLACEHOLDER = "sk-在这里填你的-DeepSeek-Key"


def _resolve_llm_key() -> tuple[str, str]:
    """按顺序找第一个有值的 Key 环境变量，返回 ``(来源变量名, 值)``。"""
    for name in LLM_KEY_ENV_ORDER:
        value = (os.getenv(name) or "").strip()
        if value:
            return name, value
    return "", LLM_KEY_PLACEHOLDER


def llm_key_from_file() -> bool:
    """当前生效的 Key 是不是来自 ``.env`` / ``.env.local``（便于日志排查）。"""
    source = LLM_API_KEY_SOURCE
    if not source:
        return False
    return _FILE_INJECTED.get(source) == os.getenv(source)


LLM_API_KEY_SOURCE, LLM_API_KEY = _resolve_llm_key()
LLM_BASE_URL = (
    (os.getenv("LLM_BASE_URL") or "").strip()
    or LLM_BASE_BY_KEY_ENV.get(LLM_API_KEY_SOURCE, LLM_BASE_DEFAULT)
)
LLM_MODEL = os.getenv("LLM_MODEL", "deepseek-flash")
# 单次请求超时（秒）
LLM_TIMEOUT_S = float(os.getenv("LLM_TIMEOUT_S", "60"))
# 图片字节上限（超过直接降级 OCR，避免把大图塞进请求）
LLM_MAX_IMAGE_BYTES = int(os.getenv("LLM_MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))
# 输出上限：deepseek-flash 这类**推理模型**会先把思维链写进 reasoning_content，
# 2048 会在"思考阶段"就被截断（finish_reason=length，正文为空）——所以默认给到 8192。
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "8192"))
# 转录结果缓存：同一张图（sha256 相同）不重复计费
LLM_CACHE_TTL_SECONDS = float(os.getenv("LLM_CACHE_TTL_SECONDS", "3600"))
LLM_CACHE_MAX_ENTRIES = int(os.getenv("LLM_CACHE_MAX_ENTRIES", "16"))