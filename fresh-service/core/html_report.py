# -*- coding: utf-8 -*-
"""解析报告的 HTML 渲染（**纯函数**：不依赖 MCP、不碰文件系统、不发请求）。

为什么要有这份报告（2026-11-13）：
三表 JSON 给模型读很合适，给人读不合适——文员想在聊天区**一眼看到**这次识别到底
多少行自动过、多少行要人确认、哪些是异常。报告是一份自包含静态页，与三表 xlsx
一起经 ``resultUrl`` 回写文件空间，用户点开即读。

三条硬约束（与 ``bom-service/report.py`` 同一套，改之前先读完）：

1. **不假设有脚本**：平台把文件空间的 ``.html`` 以 ``sandbox=""`` + ``CSP: sandbox``
   内联预览（``agent-backend/src/routes/files.ts``、``frontend/.../WorkspacePanel.vue``），
   JS **不会执行**、下载被禁止。所以折叠只用原生 ``<details>/<summary>``，
   MUST NOT 引入任何 ``<script>``；也**没有导出按钮**——真正的下载入口是平台在聊天区
   渲染的那一行（顶层 ``filePath`` 指向本报告，``excelFile`` 指向 xlsx）。
2. **不引用任何外部资源**：无 CDN、无外链字体/图标（内网部署 + 沙箱 + 可能离线）。
3. **表格必须有上限**：报告是摘要视图、xlsx 才是全量，超限整行不渲染并在末尾说明
   （``MAX_REPORT_ROWS``），避免一次大订单把回写撞上平台 5MB bodyLimit。

安全：订单行文本、商品名、异常说明全部来自 OCR 与 xlsx，一律 ``html.escape``——
即便脚本被沙箱关掉，未转义的 ``<`` 也足以把版面撕开（报告本身还是可下载的文件）。

无障碍（宪章原则四）：三档结论既有颜色也有**文字标签**（"需人工确认"/"异常"），
不靠颜色单独传达信息；表格带 ``scope="col"`` 表头，纯表格无交互控件。
"""

from __future__ import annotations

import html
import os
from datetime import datetime
from typing import Mapping, Sequence

#: 报告文件名后缀（与 xlsx 同一 job 主干，靠后缀区分两条入口）
REPORT_SUFFIX = ".html"

#: 单表在报告内最多展示的行数（超出只留一行说明）
MAX_REPORT_ROWS = int(os.getenv("FRESH_REPORT_MAX_ROWS", "200"))

#: 候选审核表里最多列出几个候选（与 ``config.TOP_N`` 同一量级，展示用的独立上限）
MAX_CANDIDATES = int(os.getenv("FRESH_REPORT_MAX_CANDIDATES", "5"))

#: 异常类型 → 中文解释。**只做展示**：判据与取值仍在 ``core/pipeline.py`` 与 matcher 里
ERROR_TYPE_LABELS = {
    "OCR_EMPTY": "未识别到文字",
    "NO_SKU_MATCH": "无任何可用候选",
    "LOW_CONFIDENCE_NO_CANDIDATE": "置信度低且无候选",
    "REVIEW_REJECTED": "审核拒绝",
    "REVIEW_PENDING": "待人工审核",
}

_CSS = """
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#f5f6f8;color:#1f2329;
  font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:1080px;margin:0 auto;padding:28px 24px 56px}
h1{font-size:20px;margin:0 0 6px;letter-spacing:.2px}
h2{font-size:14px;font-weight:600;color:#475467;margin:26px 0 10px;
  padding-bottom:8px;border-bottom:1px solid #e4e7ec}
.head{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:20px 22px}
.head .sub{color:#667085;font-size:12.5px;margin:0}
.head .concl{margin:12px 0 0;padding:10px 12px;border-radius:8px;background:#f0f7ff;
  border:1px solid #d6e6ff;color:#1d4ed8;font-size:13px}
.head .concl--bad{background:#fef3f2;border-color:#fecdca;color:#b42318}
.cards{display:grid;gap:10px;margin-top:14px;
  grid-template-columns:repeat(auto-fit,minmax(118px,1fr))}
.card{background:#fff;border:1px solid #e4e7ec;border-radius:10px;padding:12px 14px}
.card .k{color:#667085;font-size:12px}
.card .v{font-size:19px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:2px}
.panel{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:14px 16px;
  overflow-x:auto}
.file{font-size:13.5px;margin:0}
.file b{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
.hint{color:#667085;font-size:12.5px;margin:8px 0 0}
.more{color:#667085;font-size:12.5px;margin:10px 0 0}
.empty{color:#98a2b3;font-size:13px;margin:0}
.muted{color:#98a2b3}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{text-align:left;vertical-align:top;padding:7px 10px;border-top:1px solid #eaecf0}
th{background:#f9fafb;color:#475467;font-weight:600;white-space:nowrap}
td.num{font-variant-numeric:tabular-nums;white-space:nowrap}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.cand{display:inline-block;margin:0 10px 0 0;white-space:nowrap}
.cand .sc{color:#98a2b3;margin-left:4px;font-variant-numeric:tabular-nums}
.rec{display:inline-block;margin-left:6px;padding:0 6px;border-radius:5px;
  background:#ecfdf3;color:#067647;border:1px solid #abefc6;font-size:11.5px}
.tag{display:inline-block;padding:0 6px;border-radius:5px;font-size:11.5px;
  background:#f2f4f7;color:#475467;font-variant-numeric:tabular-nums}
.tag--warn{background:#fffaeb;color:#b54708;border:1px solid #fedf89}
.tag--bad{background:#fef3f2;color:#b42318;border:1px solid #fecdca}
@media print{body{background:#fff}.panel,.head,.card{break-inside:avoid}}
"""


# ---------------------------------------------------------------- 取值与格式化

def _esc(value) -> str:
    """统一转义入口：除 ``None`` 外一律转字符串再转义。"""
    return "" if value is None else html.escape(str(value), quote=True)


def _text(value) -> str:
    """字段 → 折成单行、去首尾空白的字符串（``None`` → 空串）。"""
    if value is None:
        return ""
    return " ".join(str(value).split())


def _score(value) -> str:
    """置信分 → 一位小数（fuzz 分值本身不均匀，多留小数没有信息量）。"""
    if value is None or isinstance(value, bool):
        return ""
    try:
        return f"{float(value):.1f}"
    except (TypeError, ValueError):
        return _text(value)


def report_filename(base: str) -> str:
    """报告文件名：与 xlsx **同一个 job 主干** + ``_报告.html``。

    同一主干让人一眼看出"这两条入口是同一次解析"。平台侧 job_id 仍按文件名主干算，
    两条 sidecar 记录彼此独立——删掉一个不会留下悬空引用（报告里也没有指向 xlsx 的链接）。
    """
    return f"{base}_报告{REPORT_SUFFIX}"


# ---------------------------------------------------------------- 表格片段

def _rows_note(total: int, shown: int, sheet: str) -> str:
    """超限说明：缺口一次交代清楚，不在表里留半截行。"""
    if total <= shown:
        return ""
    return (f'<p class="more">共 {total} 行，报告内展示前 {shown} 行；'
            f'完整数据见随附 xlsx 的「{_esc(sheet)}」表。</p>')


def _dict_rows(rows: Sequence | None) -> list[Mapping]:
    """只保留 Mapping 行（脏数据静默跳过：报告不该因一行异常整页打不开）。"""
    return [row for row in (rows or ()) if isinstance(row, Mapping)]


def _candidates_html(candidates) -> str:
    """候选列表：**首个标「推荐」**（文字标签，不靠颜色），其余按分数降序展示。"""
    items = [c for c in (candidates or ()) if isinstance(c, Mapping)]
    if not items:
        return '<span class="muted">（无候选）</span>'
    parts: list[str] = []
    for index, cand in enumerate(items[:MAX_CANDIDATES]):
        score = _score(cand.get("score"))
        suffix = f'<span class="sc">{score}</span>' if score else ""
        if index == 0:
            parts.append(f'<span class="cand"><b>{_esc(_text(cand.get("name")))}</b>'
                         f'<span class="rec">推荐</span>{suffix}</span>')
        else:
            parts.append(f'<span class="cand">{_esc(_text(cand.get("name")))}{suffix}</span>')
    if len(items) > MAX_CANDIDATES:
        parts.append(f'<span class="muted">另有 {len(items) - MAX_CANDIDATES} 个候选</span>')
    return "".join(parts)


def _auto_table(rows: Sequence | None) -> tuple[str, int]:
    """高度匹配表 → (html, 已展示行数)。**超限缺口由调用方统一交代**。"""
    items = _dict_rows(rows)
    shown = items[:MAX_REPORT_ROWS]
    if not shown:
        return '<p class="empty">没有高度匹配行（本次没有可直接采用的识别结果）。</p>', 0
    body = "".join(
        "<tr>"
        f'<td>{_esc(_text(row.get("raw_line")))}</td>'
        f'<td>{_esc(_text(row.get("normalized_name")))}</td>'
        f'<td class="num">{_esc(_text(row.get("quantity")))}</td>'
        f'<td>{_esc(_text(row.get("matched_name")))}</td>'
        f'<td class="num"><code>{_esc(_text(row.get("sku_id")))}</code></td>'
        f'<td class="num">{_esc(_score(row.get("score")))}</td>'
        "</tr>"
        for row in shown
    )
    html_out = (
        "<table><thead><tr>"
        '<th scope="col">原始行</th><th scope="col">标准化名称</th>'
        '<th scope="col">数量</th><th scope="col">匹配商品</th>'
        '<th scope="col">SKU编码</th><th scope="col">置信度</th>'
        f"</tr></thead><tbody>{body}</tbody></table>"
    )
    return html_out, len(shown)


def _review_table(rows: Sequence | None) -> tuple[str, int]:
    """候选审核表 → (html, 已展示行数)。"""
    items = _dict_rows(rows)
    shown = items[:MAX_REPORT_ROWS]
    if not shown:
        return '<p class="empty">没有待人工确认的行。</p>', 0
    body = "".join(
        "<tr>"
        f'<td>{_esc(_text(row.get("raw_line")))}</td>'
        f'<td>{_esc(_text(row.get("normalized_name")))}</td>'
        f'<td class="num">{_esc(_text(row.get("quantity")))}</td>'
        f'<td class="num">{_esc(_score(row.get("top_score")))}</td>'
        f'<td>{_candidates_html(row.get("candidates"))}</td>'
        "</tr>"
        for row in shown
    )
    html_out = (
        "<table><thead><tr>"
        '<th scope="col">原始行</th><th scope="col">标准化名称</th>'
        '<th scope="col">数量</th><th scope="col">最高分</th>'
        '<th scope="col">候选（首个为推荐）</th>'
        f"</tr></thead><tbody>{body}</tbody></table>"
    )
    return html_out, len(shown)


def _error_table(rows: Sequence | None) -> tuple[str, int]:
    """异常记录表 → (html, 已展示行数)。"""
    items = _dict_rows(rows)
    shown = items[:MAX_REPORT_ROWS]
    if not shown:
        return '<p class="empty">没有异常记录。</p>', 0
    body_parts: list[str] = []
    for row in shown:
        error_type = _text(row.get("error_type"))
        label = ERROR_TYPE_LABELS.get(error_type, "其他异常")
        # 待审核/其他异常是「需要人看一眼」，拒绝与识别失败是「已经确定有问题」，
        # 用两个色阶区分；语义同时写在文字里（不靠颜色单独传达）
        cls = "tag tag--bad" if error_type in ("OCR_EMPTY", "NO_SKU_MATCH", "REVIEW_REJECTED") \
            else "tag tag--warn"
        body_parts.append(
            "<tr>"
            f'<td>{_esc(_text(row.get("raw_line")))}</td>'
            f'<td>{_esc(_text(row.get("normalized_name")))}</td>'
            f'<td class="num">{_esc(_text(row.get("quantity")))}</td>'
            f'<td><span class="{cls}">{_esc(label)}</span>'
            f'<br><code>{_esc(error_type or "UNKNOWN")}</code></td>'
            f'<td>{_esc(_text(row.get("top_candidate")))}</td>'
            f'<td class="num">{_esc(_score(row.get("top_score")))}</td>'
            f'<td>{_esc(_text(row.get("message")))}</td>'
            "</tr>"
        )
    html_out = (
        "<table><thead><tr>"
        '<th scope="col">原始行</th><th scope="col">标准化名称</th>'
        '<th scope="col">数量</th><th scope="col">异常类型</th>'
        '<th scope="col">最高候选</th><th scope="col">最高分</th>'
        '<th scope="col">说明</th>'
        f"</tr></thead><tbody>{''.join(body_parts)}</tbody></table>"
    )
    return html_out, len(shown)


# ---------------------------------------------------------------- 页面装配

def _cards(auto_total: int, review_total: int, error_total: int) -> str:
    items = [
        ("高度匹配", auto_total),
        ("候选审核", review_total),
        ("异常记录", error_total),
        ("合计", auto_total + review_total + error_total),
    ]
    return "".join(
        f'<div class="card"><div class="k">{_esc(label)}</div>'
        f'<div class="v">{_esc(str(value))}</div></div>'
        for label, value in items
    )


def _conclusion(auto_total: int, review_total: int, error_total: int) -> tuple[str, str]:
    """一句话结论 → (css 类, 文案)。有异常/待审核时用红色底，避免"看着像全绿"。"""
    if review_total == 0 and error_total == 0:
        return "concl", f"全部 {auto_total} 行均已高度匹配，无需人工处理。"
    parts = [f"高度匹配 {auto_total} 行"]
    if review_total:
        parts.append(f"{review_total} 行需人工确认")
    if error_total:
        parts.append(f"{error_total} 行异常")
    return "concl concl--bad", "；".join(parts) + "。请按下方清单核对后导出。"


def build_report(
    auto_rows: Sequence | None,
    review_rows: Sequence | None,
    error_rows: Sequence | None,
    *,
    source: str = "",
    workbook_name: str = "",
    generated_at: str | None = None,
) -> bytes:
    """生成解析报告（UTF-8 字节）。**不抛业务异常**：脏字段退化为空展示。

    ``workbook_name`` 是随附三表 xlsx 的文件名——只**写进页面**供人对照，不做链接
    （沙箱禁止下载，也铸不出平台签名直链）。
    """
    auto_total = len(_dict_rows(auto_rows))
    review_total = len(_dict_rows(review_rows))
    error_total = len(_dict_rows(error_rows))

    stamp = generated_at or datetime.now().strftime("%Y-%m-%d %H:%M")
    auto_html, auto_shown = _auto_table(auto_rows)
    review_html, review_shown = _review_table(review_rows)
    error_html, error_shown = _error_table(error_rows)

    concl_cls, concl_text = _conclusion(auto_total, review_total, error_total)

    meta_bits = [f"来源 {_esc(source or '（未命名订单）')}", f"生成于 {_esc(stamp)}"]
    if workbook_name:
        file_line = f"三表工作簿：<b>{_esc(workbook_name)}</b>"
    else:
        file_line = "三表工作簿：本次未产出（只返回了解析结果）"

    doc = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>生鲜订单解析报告 · {_esc(source or "订单")}</title>
<style>{_CSS}</style>
</head>
<body>
<main>
  <header class="head">
    <h1>生鲜订单解析报告</h1>
    <p class="sub">{' · '.join(meta_bits)}</p>
    <p class="{concl_cls}">{_esc(concl_text)}</p>
  </header>

  <section class="cards">{_cards(auto_total, review_total, error_total)}</section>

  <h2>高度匹配</h2>
  <div class="panel">{auto_html}{_rows_note(auto_total, auto_shown, "高度匹配")}</div>

  <h2>候选审核</h2>
  <div class="panel">{review_html}{_rows_note(review_total, review_shown, "候选审核")}</div>

  <h2>异常记录</h2>
  <div class="panel">{error_html}{_rows_note(error_total, error_shown, "异常记录")}</div>

  <h2>导出</h2>
  <div class="panel">
    <p class="file">{file_line}</p>
    <p class="hint">本报告在平台内以沙箱页打开（脚本与下载被平台关闭），因此这里只写文件名、
      不放下载按钮。导出请点聊天区下方的入口行，或右上角铃铛「后台记录」——
      数据以那份三表 xlsx 为准，本报告只是摘要视图。</p>
  </div>
</main>
</body>
</html>
"""
    return doc.encode("utf-8")
