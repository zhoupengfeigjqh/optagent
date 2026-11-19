# -*- coding: utf-8 -*-
"""
LLM 读图：把**手写单**转录成"每行一条商品"的文本。

定位：只替换"识别"这一环，不做纠错、不做补全、不做匹配——
转录结果交给现有 ``pipeline.analyze_order``（标准化 + 模糊匹配 + 三表），
因此后续流程与 OCR 链路完全一致。

约束：
- 走 OpenAI 兼容的 ``/chat/completions`` 视觉接口（base_url / model 均可配）；
- **未配置 API Key 时 ``is_configured()`` 为 False**，调用方自动回退 OCR+版面层；
- 任何网络/解析异常都抛 :class:`LLMError`，绝不吞掉上层流程；
- 按图片 sha256 缓存转录结果，同一张图重复调用不重复计费。
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

import httpx

from . import config
from .cache import TTLCache


class LLMError(RuntimeError):
    """LLM 不可用 / 调用失败 / 返回无法解析。"""


DEFAULT_BASE_URL = "https://api.deepseek.com/v1"
DEFAULT_MODEL = "deepseek-flash"
#: Key 里出现这些字样就当"没配置"（占位符），避免拿假 Key 去请求
_PLACEHOLDER_HINTS = ("在这里填", "your-key", "your_key", "sk-xxx", "<", ">")

#: 只转录的口径：不纠错、不补全、不带表头/标题/页码
PROMPT = (
    "你是单据转录助手，只做逐行转录，绝不纠错、绝不补全、绝不猜测。\n"
    "要求：\n"
    "1) 每行输出一条商品，格式为「品名 数量单位」，例如：海天生抽 3件；\n"
    "2) 严格照抄图上的字：形近字、错别字也照抄；看不清的字用 ? 代替；\n"
    "3) 数量与单位保留原始写法（如 20斤、5包、3件、5桶、2箱）；\n"
    "4) 不要输出表头（序号/品名/数量/单位/单价/备注）、标题、日期、页码、签名；\n"
    "5) 不要编号、不要 Markdown 代码块、不要任何解释；\n"
    "6) 图里若分左右两栏，先左栏从上到下、再右栏从上到下。"
)

_HEADER_RE = re.compile(
    r"(序号|品名|商品名称|货品名称|数量|单位|单价|金额|备注|合计|小计|总计|"
    r"采购订单|需求日期|送货|送到)"
)
_PAGE_RE = re.compile(r"(第\s*\d+\s*页|共\s*\d+\s*页)")
_DATE_RE = re.compile(r"^\s*\d{4}[.\-/年]\d{1,2}([.\-/月]\d{1,2})?\s*$")
#: "数字+数量单位"锚点：用于区分"表头行"与"真正的商品行"
_ANCHOR_RE = re.compile(
    r"\d+(?:\.\d+)?\s*(?:件|瓶|包|箱|桶|罐|盒|袋|支|个|斤|块|扎|提|板|条|把|份|颗|根|片)"
)
_MAGIC = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG", "image/png"),
    (b"GIF8", "image/gif"),
    (b"BM", "image/bmp"),
    (b"RIFF", "image/webp"),
)
_SUFFIX_MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
                ".bmp": "image/bmp", ".webp": "image/webp", ".gif": "image/gif"}


def api_key() -> str:
    """Key 的来源优先级：环境变量 > ``.env.local`` > ``core/config.py`` 的默认值。"""
    return (config.LLM_API_KEY or "").strip()


def key_source() -> str:
    """Key 是从哪个环境变量来的（``LLM_API_KEY`` / ``DEEPSEEK_API_KEY`` / ``DASHSCOPE_API_KEY`` / …）。

    空字符串表示"没有从环境变量拿到"（用的是 config 默认值或占位符）。
    """
    return (getattr(config, "LLM_API_KEY_SOURCE", "") or "").strip()


def base_url() -> str:
    value = (config.LLM_BASE_URL or DEFAULT_BASE_URL).strip().rstrip("/")
    return value or DEFAULT_BASE_URL


def model() -> str:
    return (config.LLM_MODEL or DEFAULT_MODEL).strip() or DEFAULT_MODEL


def timeout_s() -> float:
    try:
        return float(config.LLM_TIMEOUT_S)
    except (TypeError, ValueError):
        return 60.0


def max_image_bytes() -> int:
    try:
        return int(config.LLM_MAX_IMAGE_BYTES)
    except (TypeError, ValueError):
        return 8 * 1024 * 1024


def max_tokens() -> int:
    try:
        return int(config.LLM_MAX_TOKENS)
    except (TypeError, ValueError):
        return 2048


def is_configured() -> bool:
    """是否配置了可用的 API Key（只判断有没有，不发请求；占位符算未配置）。"""
    key = api_key()
    if not key or len(key) < 8:
        return False
    return not any(hint in key for hint in _PLACEHOLDER_HINTS)


# 图片 sha256 -> 转录行；同图重复调用不重复计费
_CACHE: TTLCache[list[str]] = TTLCache(
    float(config.LLM_CACHE_TTL_SECONDS or 3600),
    int(config.LLM_CACHE_MAX_ENTRIES or 16),
)


def _load_image(image_path_or_url: str) -> tuple[bytes, str]:
    """读取图片字节（支持本地路径 / http 直链），返回 (bytes, mime)。"""
    url = (image_path_or_url or "").strip()
    if url.startswith(("http://", "https://")):
        try:
            resp = httpx.get(url, timeout=timeout_s(), follow_redirects=True)
            resp.raise_for_status()
        except Exception as exc:                            # noqa: BLE001
            raise LLMError(f"下载图片失败：{exc.__class__.__name__}: {exc}") from exc
        data = resp.content
    else:
        path = Path(url)
        if not path.exists():
            raise LLMError(f"图片不存在：{image_path_or_url}")
        data = path.read_bytes()

    limit = max_image_bytes()
    if len(data) > limit:
        raise LLMError(f"图片 {len(data)} 字节，超过 LLM_MAX_IMAGE_BYTES={limit}")
    mime = next((m for magic, m in _MAGIC if data.startswith(magic)), "")
    if not mime:
        mime = _SUFFIX_MIME.get(path.suffix.lower(), "image/jpeg") if not url.startswith("http") \
            else "image/jpeg"
    return data, mime


def _error_hint(status: int) -> str:
    """把常见失败翻译成"下一步该改什么"，省去猜。"""
    hints: list[str] = []
    if status in (401, 403):
        hints.append("Key 无效/无权限，确认变量名与额度")
    if status in (400, 404):
        hints.append(f"检查模型名与端点：LLM_MODEL={model()} / LLM_BASE_URL={base_url()}")
    if key_source() == "DASHSCOPE_API_KEY" and model().lower().startswith("deepseek"):
        hints.append("百炼上的 deepseek 系列多为纯文本模型，读图请改用 qwen-vl-max / qwen3-vl-plus 等视觉模型")
    return ("；提示：" + "；".join(hints)) if hints else ""


def _post(payload: dict, transport: httpx.BaseTransport | None = None) -> dict:
    """POST ``/chat/completions``；``transport`` 仅测试用（注入假响应）。"""
    if not is_configured():
        raise LLMError("未配置 LLM Key（LLM_API_KEY / DEEPSEEK_API_KEY / DASHSCOPE_API_KEY / OPENAI_API_KEY 任一即可）")
    headers = {"Authorization": f"Bearer {api_key()}", "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=timeout_s(), transport=transport) as client:
            resp = client.post(f"{base_url()}/chat/completions", json=payload, headers=headers)
    except Exception as exc:                                # noqa: BLE001
        raise LLMError(f"调用 LLM 失败：{exc.__class__.__name__}: {exc}") from exc
    if resp.status_code != 200:
        body = (resp.text or "").strip().replace("\n", " ")[:200]
        raise LLMError(f"LLM 返回 HTTP {resp.status_code}：{body}{_error_hint(resp.status_code)}")
    try:
        return resp.json()
    except ValueError as exc:
        raise LLMError("LLM 返回不是合法 JSON") from exc


def parse_response(content: str) -> list[str]:
    """把模型输出解析成"每行一条商品"的文本行（纯函数，便于单测）。"""
    text = (content or "").strip()
    # 去掉可能出现的 ``` 代码块围栏
    text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    lines: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        line = re.sub(r"^[\-\*\u2022]\s*", "", line)          # 去掉项目符号
        line = re.sub(r"^\d+\s*[.、)]\s*", "", line)         # 去掉行号
        if not line:
            continue
        if _PAGE_RE.search(line) or _DATE_RE.match(line):
            continue
        anchor = bool(_ANCHOR_RE.search(line))
        header_hits = len(_HEADER_RE.findall(line))
        # 表头行：命中 ≥2 个列名词且没有"数量+单位"锚点
        if header_hits >= 2 and not anchor:
            continue
        if _HEADER_RE.fullmatch(line):
            continue
        if not re.search(r"[\u4e00-\u9fff]", line) and not anchor:
            continue
        lines.append(line)
    return lines


def _request_lines(data: bytes, mime: str,
                   transport: httpx.BaseTransport | None = None) -> list[str]:
    payload = {
        "model": model(),
        "temperature": 0,
        "max_tokens": max_tokens(),
        "messages": [
            {"role": "system", "content": PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "请转录这张单据。"},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
                        },
                    },
                ],
            },
        ],
    }
    body = _post(payload, transport=transport)
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError(f"LLM 响应结构异常：{str(body)[:200]}") from exc
    if isinstance(content, list):                       # 少数实现返回分段内容
        content = "".join(str(part.get("text", "")) if isinstance(part, dict) else str(part)
                          for part in content)
    lines = parse_response(str(content))
    if not lines:
        raise LLMError("LLM 没有返回可用的转录行")
    return lines


def read_lines(image_path_or_url: str,
               transport: httpx.BaseTransport | None = None) -> list[str]:
    """识别图片为"每行一条商品"的文本行；失败抛 :class:`LLMError`。"""
    if not is_configured():
        raise LLMError("未配置 LLM_API_KEY / DEEPSEEK_API_KEY")
    data, mime = _load_image(image_path_or_url)
    digest = hashlib.sha256(data).hexdigest()
    return _CACHE.get_or_load(digest, lambda: _request_lines(data, mime, transport))


def clear_cache() -> None:
    """清空转录缓存（换模型/改提示词后需要）。"""
    _CACHE.clear()


def config_summary() -> dict:
    """给日志/报告用的一行配置摘要（不含 Key 本身）。"""
    summary = {
        "configured": is_configured(),
        "key_from": key_source() or "(config 默认值/占位符)",
        "base_url": base_url(),
        "model": model(),
        "timeout_s": timeout_s(),
        "max_image_bytes": max_image_bytes(),
    }
    if key_source() == "DASHSCOPE_API_KEY" and model().lower().startswith("deepseek"):
        summary["hint"] = "百炼上的 deepseek 系列多为纯文本模型；读图请把 LLM_MODEL 设为 qwen-vl-max 等视觉模型"
    return summary
