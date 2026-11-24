"""
生鲜订货识别 MCP 服务（fresh_food_mcp_v1）。

单一工具 fresh_order_parse：四个入参（订单图片 + SKU清单 / 映射表 / 噪声词表），
一次完成「加载商品数据 → 图片 OCR 识别 → 标准化/匹配三档分流」，直接返回三表解析结果；
声明了 resultUrl 时，再把「三表 xlsx」**回写文件空间**（服务不写本地磁盘，**不产出 HTML 报告**）。

设计约定：
- 一次调用只处理一张图片订单（image_path 单值，不接收数组）；
- 四个文件入参对**模型**是文件空间相对路径（如 `临时空间/订单1.png`），平台按 `file_args`
  声明原位铸造成签名直链后发给本服务 ⇒ **服务实际收到的必须是 http/https 直链**，
  因此 _check_http_url 拒绝相对路径（收到相对路径＝平台侧漏配 file_args）；
- 解析结果始终以 JSON 返回；产出交付是**附加**能力，失败只降级（`delivery_note` 说明原因），
  不让已经算好的解析结果跟着交不出去；
- image_path、sku_path 必填；noise_path、synonyms_path 留空时用镜像内默认文件；
- 三个数据表地址的解析结果按 TTL 缓存在进程内（见 core/cache.py）。

产出回写（2026-11-13，契约见仓库根 `异步MCP服务接入约定.md` §4.7.1，范本 `bom-service`）：
- 开关＝本工具 inputSchema 里声明 `resultUrl`：平台据此**自动注入**（模型看不到、也填不了），
  平台侧无需任何配置；
- 回写落点由平台锁死为 `临时空间/后台产出/`，`filePath` 必须回传平台响应里的 `path`
  （服务不自己拼）；
- 只产出一份文件（三表 xlsx），因此入口字段放在**顶层** `filePath` / `filePathName`
  （契约 §4.7.1：单产出不给嵌套字段）。
"""

from __future__ import annotations

import os
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from urllib.parse import parse_qsl, unquote, urlencode, urlparse, urlsplit, urlunsplit

from fastmcp import FastMCP
from pydantic import Field

from core import config, http_pool, ocr
from core.data_loader import load_product_data_three
from core.excel_export import build_output_workbook
from core.pipeline import analyze_batch

mcp = FastMCP(config.MCP_NAME)

#: 回写的整体超时（秒）：平台在本机/同网段，落盘是写文件，正常几十毫秒
_PUT_TIMEOUT_S = float(os.getenv("FRESH_PUT_TIMEOUT_S", "30"))
#: 单次回写的字节上限。平台 ``/api/files/put`` 的 bodyLimit = ``UPLOAD_MAX_MB``（默认 5MB，超限 413）：
#: 先判大小是为了**不白传一遍**（契约 §4.6）；平台若调大上限，用本变量跟上即可
_MAX_RESULT_BYTES = int(os.getenv("FRESH_RESULT_MAX_BYTES", str(5 * 1024 * 1024)))
#: 产出名里订单图名主干的最大长度（平台侧 filename 要单段、可读、不撞长度限制）
_STEM_MAX_CHARS = 40
#: 文件名里一律替换掉的字符（路径分隔符 / NTFS 保留字符 / 反斜杠）
_UNSAFE_FILENAME_CHARS = set('/\\:*?"<>|')
#: 进程内并发上限：多出来的请求最多排队 FRESH_QUEUE_TIMEOUT_S 秒，超时明确拒绝（不雪崩）
_MAX_CONCURRENT = max(1, int(os.getenv("FRESH_MAX_CONCURRENT", "4")))
_QUEUE_TIMEOUT_S = float(os.getenv("FRESH_QUEUE_TIMEOUT_S", "10"))
_GATE = threading.BoundedSemaphore(_MAX_CONCURRENT)


def _source_name(image_url: str) -> str:
    """取上传文件的原名（URL 解码后的 basename），用作三表「来源」与产出文件名主干。

    平台按 `file_args` 铸造的签名直链形如
    ``/api/files/raw?u=…&p=<数字人>/<数据域内相对路径>&exp=…&sig=…``：
    **文件名在 query 的 `p` 里，path 末段恒为 `raw`**，所以先读 `p`，
    读不到再看 path 末段（兼容对象存储等其它直链形态）。
    """
    parts = urlsplit(image_url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    for candidate in (query.get("p"), parts.path):
        name = Path(unquote(candidate or "")).name
        if name and name != "raw":
            return name
    return "订单图片"


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


def _valid_result_url(value: str) -> str:
    """``resultUrl`` 的取值口径：非 http/https **一律当没有**（契约 §6 第 2 条）。

    与 ``_check_http_url`` 的差别是**不抛错**：拿不到回写地址只是少两条入口，
    解析结果照给（服务也能被直接调用，不经过平台）。
    """
    url = (value or "").strip()
    return url if urlparse(url).scheme.lower() in ("http", "https") else ""


# ---------------------------------------------------------------- 产出命名

def _safe_stem(name: str) -> str:
    """订单图名 → 可安全出现在**平台文件名**里的主干。

    平台只校验"单段文件名 + 无 `..`"（`agent-backend/src/routes/files-put.ts`），
    但反斜杠/控制字符会让前端 view-link 的形态卫生判据丢弃整条入口，故这里先清理干净。
    """
    stem = Path(name or "").stem or "订单"
    cleaned = "".join(
        "_" if (char in _UNSAFE_FILENAME_CHARS or ord(char) < 0x20 or ord(char) == 0x7F) else char
        for char in stem
    )
    # `..` 会被平台判非法；连续点号在人眼里也没有意义，一律折成单个点
    while ".." in cleaned:
        cleaned = cleaned.replace("..", ".")
    cleaned = cleaned.strip(" ._")[:_STEM_MAX_CHARS]
    return cleaned or "订单"


def _job_base(source_name: str, now: datetime | None = None) -> str:
    """产出名主干：``{图名}_{时间戳}``（上传的图片/文件名 + 时间）。

    时间戳到秒：同一张图连续解析不会互相覆盖。
    """
    beijing_tz = timezone(timedelta(hours=8))
    dt = now or datetime.now(timezone.utc)

    # 兼容传入的无时区 datetime：按北京时间处理
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=beijing_tz)

    stamp = dt.astimezone(beijing_tz).strftime("%Y%m%d_%H%M%S")
    return f"{_safe_stem(source_name)}_{stamp}"


# ---------------------------------------------------------------- 回写

def _put_url(result_url: str, filename: str, summary: str) -> str:
    """在回写地址上追加 ``filename`` / ``summary``：**保留原有 query**（契约 §4.3）。

    必须走 URL 解析器而不是字符串拼 ``&``：地址已带 query（``u/d/exp/sig/sid/call_id/t``），
    丢掉任何一个原有参数都会 403。
    """
    parts = urlsplit(result_url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    query.append(("filename", filename))
    if summary:
        query.append(("summary", summary))
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)
    )


def _deliver(result_url: str, filename: str, data: bytes, summary: str) -> tuple[str, str]:
    """把一份产出**回写平台**（``POST /api/files/put``）；返回 ``(filePath, 失败说明)``。

    成功时 ``filePath`` = 平台返回的 ``path``（权威路径，服务不自己拼）。
    失败时返回空串 + 一行原因：调用方据此**不写 filePath**（契约 §4.7.1），
    而不是编一个点不开的路径。
    """
    if len(data) > _MAX_RESULT_BYTES:
        return "", (f"产出 {len(data)} 字节，超过回写上限 {_MAX_RESULT_BYTES} 字节"
                    f"（平台 bodyLimit；可用 FRESH_RESULT_MAX_BYTES 对齐）")
    try:
        # content-type **必须是 octet-stream**：平台只为 `application/octet-stream` /
        # `text/plain` 注册了"原样收字节"的 parser，发 xlsx/html 自己的 MIME 会被判 415
        resp = http_pool.client().post(
            _put_url(result_url, filename, summary),
            content=data,
            headers={"content-type": "application/octet-stream"},
            timeout=_PUT_TIMEOUT_S,
            follow_redirects=False,
        )
    except Exception as exc:                                # noqa: BLE001 —— 网络异常绝不穿透成工具错误
        return "", f"回写请求失败（{exc.__class__.__name__}: {exc}）"
    if resp.status_code not in (200, 202):
        body = (resp.text or "").strip().replace("\n", " ")[:200]
        return "", f"回写被拒（HTTP {resp.status_code}）：{body}"
    try:
        path = (resp.json() or {}).get("path")
    except ValueError:
        path = None
    if not isinstance(path, str) or not path:
        return "", "回写成功但响应里没有 path（拿不到 filePath）"
    return path, ""


def _one_line(text: str, limit: int = 200) -> str:
    """摘要压成一行（契约 §4.4）：界面标题是单行省略号，多行/超长都会被截断。"""
    return " ".join(str(text or "").split())[:limit]


def _workbook_bytes(auto_rows, review_rows, error_rows) -> bytes | None:
    """三表工作簿字节；**任何异常都收敛成 ``None``**（少一条入口，不影响解析结果）。"""
    try:
        return build_output_workbook(auto_rows, review_rows, error_rows)
    except Exception as exc:                                # noqa: BLE001
        print(f"三表工作簿生成失败：{exc.__class__.__name__}: {exc}", file=sys.stderr)
        return None


def _counts_text(auto_rows, review_rows, error_rows) -> str:
    """三档行数的一句话摘要（铃铛「后台记录」里的标题来源）。"""
    return (f"高度匹配 {len(auto_rows)} 行 / 待审核 {len(review_rows)} 行 / "
            f"异常 {len(error_rows)} 行")


def _deliver_output(
    result_url: str,
    *,
    base: str,
    auto_rows,
    review_rows,
    error_rows,
) -> tuple[dict, str]:
    """回写三表工作簿，返回 ``(入口字段, 要附加到结果的说明)``。

    只产出一份文件（xlsx），因此入口字段直接放**顶层** ``filePath`` / ``filePathName``
    —— 契约 §4.7.1：单产出不给嵌套字段，同一文件也不给两条入口。

    降级：生成失败或回写被拒 → 无入口 + 一行原因（解析结果照给）。
    """
    workbook_name = f"{base}.xlsx"
    workbook = _workbook_bytes(auto_rows, review_rows, error_rows)
    if workbook is None:
        return {}, "三表工作簿未生成"

    counts = _counts_text(auto_rows, review_rows, error_rows)
    path, err = _deliver(result_url, workbook_name, workbook, _one_line(f"解析结果：{counts}"))
    if err:
        print(f"三表工作簿回写失败（{workbook_name}）：{err}", file=sys.stderr)
        return {}, f"三表工作簿未交付：{err}"
    return {"filePath": path, "filePathName": workbook_name}, ""


# ---------------------------------------------------------------- 工具

def _analyze_image(image_url: str, source_name: str, data, layout: str, reader: str = "auto"):
    """路由读图：**表格走 OCR + 版面层，手写走 LLM 转录**，任何异常都退回旧的逐行 OCR。

    平台侧无需感知：入参仍是"图片地址 + 三张表"，出参仍是三表。
    返回 ``(auto, review, error, meta)``；``meta`` 用于日志与 ``reader`` 字段，便于判断走了哪条通道。
    """
    meta: dict = {"reader": "ocr-legacy", "kind": "", "note": ""}
    try:
        from core import reader as reader_mod

        result = reader_mod.analyze_image(image_url, source_name, data,
                                          reader=reader, layout=layout)
        meta = result.meta
        print(f"[reader] {source_name}: {reader_mod.describe(result.meta)}", file=sys.stderr)
        if result.rows() or not result.meta.get("note"):
            return result.auto, result.review, result.error, meta
        print(f"[reader] {source_name}: 未产出任何行，回退逐行 OCR", file=sys.stderr)
        meta = {"reader": "ocr-legacy", "kind": "", "note": "读图路由没有产出任何行"}
    except Exception as exc:                                # noqa: BLE001
        print(f"[reader] {source_name}: 读图路由失败，回退逐行 OCR"
              f"（{exc.__class__.__name__}: {exc}）", file=sys.stderr)
        meta = {"reader": "ocr-legacy", "kind": "",
                "note": f"读图路由失败：{exc.__class__.__name__}: {exc}"}
    auto, review, error = analyze_batch([(source_name, "", image_url)], data)
    return auto, review, error, meta


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
    resultUrl: Annotated[
        str,
        Field(
            title="结果回写地址",
            description=(
                "产出回写地址。**由运行环境自动注入，请勿自行填写**；"
                "留空（默认）时只返回解析结果、不交付 xlsx"
            ),
        ),
    ] = "",
    layout: Annotated[
        str,
        Field(
            title="版面模式",
            description=(
                "版面归一层开关：auto（默认，自动判别表格/手写列表）/ table / list / off。"
                "**通常无需填写**；off 时退回旧的逐行 OCR 链路"
            ),
        ),
    ] = "auto",
    reader: Annotated[
        str,
        Field(
            title="识别通道",
            description=(
                "识别通道：auto（默认，表格走 OCR、手写走 LLM）/ ocr / llm。"
                "**通常无需填写**；未配置 LLM Key 时 auto 自动按 OCR 处理"
            ),
        ),
    ] = "auto",
) -> dict:
    """
    解析一张生鲜订货单据图片，产出 SKU 匹配三表，并可交付一份三表工作簿 xlsx。

    四个文件入参在工具声明里都是**文件空间相对路径**（如 `临时空间/订单1.png`）：
    平台按 `file_args` 声明把它们原位铸造成签名直链再发给本服务，模型不必、也不应填 http 地址。

    Args:
        image_path: 订单图片的文件空间相对路径（单张图片，必填）。
        sku_path: SKU清单 xlsx 的文件空间相对路径（必填）。
        noise_path: 噪声词表 xlsx 的相对路径（留空用服务内置默认表）。
        synonyms_path: 映射表 xlsx 的相对路径（留空用服务内置默认表）。
        resultUrl: 产出回写地址（平台自动注入；模型不填）。
        layout: 版面模式（auto/table/list/off），默认 auto；平台侧无需填写。
        reader: 识别通道（auto/ocr/llm），默认 auto；平台侧无需填写。

    返回 JSON（每行均带 order_no / source）：
        auto_rows    —— 高度匹配行：raw_line、normalized_name、quantity、unit、
                        matched_name、sku_id、score 等
        review_rows  —— 候选审核行：raw_line、normalized_name、quantity、
                        top_score、candidates[{name, sku_id, score}] 等
        error_rows   —— 异常记录行：raw_line、error_type、top_candidate、
                        top_score、candidates、message 等
        auto_count / review_count / error_count —— 三表行数

    产出交付（收到 resultUrl 且回写成功时，末尾多出这些字段）：
        filePath / filePathName —— 三表工作簿 xlsx（文件空间相对路径，点开即下载）
        delivery_note —— 仅在 xlsx 没交付时出现，说明原因（解析结果不受影响）
    """
    # 并发闸门：满员时最多排队 _QUEUE_TIMEOUT_S 秒，超时明确拒绝（而不是一起变慢到超时）
    if not _GATE.acquire(timeout=_QUEUE_TIMEOUT_S):
        raise ValueError(
            f"当前解析请求已满（并发上限 {_MAX_CONCURRENT}），"
            f"排队超过 {_QUEUE_TIMEOUT_S:g} 秒，请稍后重试"
        )
    try:
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
        auto, review, error, read_meta = _analyze_image(image_url, source_name, data, layout, reader)

        result = {
            "auto_rows": auto, "auto_count": len(auto),
            "review_rows": review, "review_count": len(review),
            "error_rows": error, "error_count": len(error),
            "reader": read_meta.get("reader", ""),
        }

        # 回写是附加能力：拿不到合法地址就只返回解析结果（服务也能被直接调用）
        put_url = _valid_result_url(resultUrl)
        if not put_url:
            return result

        entries, note = _deliver_output(
            put_url,
            base=_job_base(source_name),
            auto_rows=auto,
            review_rows=review,
            error_rows=error,
        )
        result.update(entries)
        if note:
            result["delivery_note"] = note
        return result
    finally:
        _GATE.release()


if __name__ == "__main__":
    import uvicorn

    ocr.warmup()                                    # 模型加载挪到启动，首个请求不再等 5.7s
    app = mcp.http_app(path=config.MCP_PATH, transport="streamable-http")

    print(f"[{config.MCP_NAME}] MCP 端点:  http://{config.MCP_HOST}:{config.MCP_PORT}{config.MCP_PATH}")
    uvicorn.run(app, host=config.MCP_HOST, port=config.MCP_PORT, log_level="info")
