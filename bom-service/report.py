# -*- coding: utf-8 -*-
"""合并报告的 HTML 渲染（**纯函数**：不依赖 MCP、不碰文件系统、不发请求）。

为什么是 HTML 而不是把结构塞进 JSON 正文（2026-10-22）：
``bom_merge`` 的统计与问题清单本身很小，但"三百多行多级结构"放进模型上下文既浪费预算、
人也没法读。报告改为**一个自包含的静态页**，与合并产出的 xlsx 一起回写平台，
用户从聊天区入口点开就是可读的树与表。

三条硬约束（改之前先读完）：

1. **不假设有脚本**：平台把文件空间的 ``.html`` 以 ``sandbox=""`` + ``CSP: sandbox``
   内联预览（`agent-backend/src/routes/files.ts`、`frontend/.../WorkspacePanel.vue`），
   JS **不会执行**。所以"点开/收起"只能用原生 ``<details>/<summary>``（无 JS 也能交互，
   还自带键盘操作），MUST NOT 引入任何 ``<script>``。
2. **不引用任何外部资源**：无 CDN、无外链字体/图标（内网部署 + 沙箱 + 可能离线）。
   CSS 内联，记号一律用文字。
3. **报告里没有下载链接**（刻意）：沙箱禁止下载（无 ``allow-downloads``），服务也铸不出
   平台签名直链（密钥在平台侧，契约 §10.6 不变式 3）。这里只**写文件名**，真正的下载入口
   是平台在聊天区渲染的那几行（``filePath`` 指向本报告，``mergedFile`` 指向 xlsx）。

安全：所有来自 excel 的字符串（编码、描述、文件名、问题说明）一律 ``html.escape``——
即便脚本被沙箱关掉，未转义的 ``<`` 也足以把版面撕开（而且报告本身是可被下载的文件）。
"""

import html
import os
from datetime import datetime
from typing import Mapping

from bom_core import RESULT_SUFFIX_XLSX

#: 报告文件名后缀（与 xlsx 同一 job 主干，靠后缀区分两条入口）
REPORT_SUFFIX = ".html"
#: 报告内展开的节点上限：超出只留一行说明，避免 HTML 撞平台 5MB 回写上限
MAX_REPORT_NODES = int(os.environ.get("BOM_REPORT_MAX_NODES", "3000"))
#: 报告内列出的事件上限（JSON 正文只给前 max_issues 条，报告给得更多但有界）
MAX_REPORT_ISSUES = int(os.environ.get("BOM_REPORT_MAX_ISSUES", "200"))

_CSS = """
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
.card .v small{font-size:12px;font-weight:400;color:#98a2b3;margin-left:4px}
.panel{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:16px 18px}
.file{font-size:13.5px;margin:0}
.file b{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
.hint{color:#667085;font-size:12.5px;margin:8px 0 0}
.tree{font-size:13px}
details.node{margin:2px 0}
details.node>summary{cursor:pointer;padding:3px 6px;border-radius:6px}
details.node>summary:hover{background:#f4f6fa}
details.node>summary:focus-visible{outline:2px solid #84adff;outline-offset:1px}
.kids{margin-left:10px;padding-left:14px;border-left:1px dashed #d0d5dd}
.line{padding:3px 6px 3px 20px}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
.code--comp{font-weight:600}
.descr{color:#475467;margin-left:8px}
.tag{display:inline-block;margin-left:8px;padding:0 6px;border-radius:5px;
  background:#f2f4f7;color:#475467;font-size:11.5px;font-variant-numeric:tabular-nums}
.badge{display:inline-block;margin-left:8px;padding:0 6px;border-radius:5px;font-size:11.5px;
  background:#fef3f2;color:#b42318;border:1px solid #fecdca}
.lv{display:inline-block;padding:0 6px;border-radius:5px;font-size:11.5px;
  font-variant-numeric:tabular-nums;white-space:nowrap}
.lv--error{background:#fef3f2;color:#b42318;border:1px solid #fecdca}
.lv--warn{background:#fffaeb;color:#b54708;border:1px solid #fedf89}
.grp{margin:14px 0 0}
.grp h3{font-size:13px;font-weight:600;margin:0 0 8px;word-break:break-all}
.grp h3 span{font-weight:400;color:#667085;margin-left:8px;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{text-align:left;vertical-align:top;padding:7px 10px;border-top:1px solid #eaecf0}
th{background:#f9fafb;color:#475467;font-weight:600;white-space:nowrap}
td.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.more{color:#667085;font-size:12.5px;margin:10px 0 0}
.empty{color:#98a2b3;font-size:13px;margin:0}
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


def _num(value) -> str:
    """数量类字段 → 展示文本：整数不带小数点，浮点去掉多余的 0，脏值原样给。"""
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value:                     # NaN
            return ""
        return f"{value:.10g}"
    return _text(value)


def _size(num_bytes) -> str:
    """字节数 → 人读（只做展示，不参与判据）。"""
    try:
        size = float(num_bytes)
    except (TypeError, ValueError):
        return ""
    if size <= 0:
        return "0 B"
    if size < 1024:
        return f"{size:.0f} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / 1024 / 1024:.1f} MB"


def report_filename(merged_filename: str) -> str:
    """报告文件名：与 xlsx **同一个 job 主干** + ``_报告.html``。

    同一主干让"这两条入口是同一次任务"在人眼里是显然的。平台侧 ``job_id`` 仍按文件名主干算
    （``..._bom_x_报告`` 与 ``..._bom_x`` 不同），两条 sidecar 记录彼此独立——删掉一个不会留下
    悬空引用（报告里本来也没有指向 xlsx 的链接）。
    """
    stem = merged_filename or "总BOM"
    if stem.lower().endswith(RESULT_SUFFIX_XLSX):
        stem = stem[: -len(RESULT_SUFFIX_XLSX)]
    return f"{stem}_报告{REPORT_SUFFIX}"


# ---------------------------------------------------------------- 结构树

def _tree(nodes) -> dict | None:
    """扁平节点（先序 + ``level``）→ 嵌套结构。

    只认 ``level``：``bom_core.expand`` 产出的是**先序**序列，父节点必在子节点之前，
    一个栈就够（不重建 parent 链，免得多出与 core 并存的第二份真相）。
    """
    root = None
    stack = []
    for raw in nodes or ():
        if not isinstance(raw, Mapping):
            continue
        try:
            level = int(raw.get("level") or 0)
        except (TypeError, ValueError):
            level = 0
        node = {
            "level": level,
            "code": _text(raw.get("mat_code")),
            "descr": _text(raw.get("descr")),
            "posiz": _text(raw.get("posiz")),
            "qty": _num(raw.get("qty")),
            "total_qty": _num(raw.get("total_qty")),
            "component": bool(raw.get("is_component")),
            "as_leaf": bool(raw.get("as_leaf")),
            "children": [],
        }
        while stack and stack[-1]["level"] >= level:
            stack.pop()
        if stack:
            stack[-1]["children"].append(node)
        elif root is None:
            root = node
        else:                                   # 防御：脏数据出现多个根行时挂到根下
            root["children"].append(node)
        stack.append(node)
    return root


def _node_html(node: Mapping) -> str:
    """一个节点的一行内容（不含外层容器）。"""
    parts = [f'<span class="{"code code--comp" if node["component"] else "code"}">'
             f'{_esc(node["code"] or "（空编码）")}</span>']
    if node["descr"]:
        parts.append(f'<span class="descr">{_esc(node["descr"])}</span>')
    if node["posiz"]:
        parts.append(f'<span class="tag">位号 {_esc(node["posiz"])}</span>')
    if node["qty"]:
        parts.append(f'<span class="tag">单层 {_esc(node["qty"])}</span>')
    if node["total_qty"]:
        parts.append(f'<span class="tag">累计 {_esc(node["total_qty"])}</span>')
    if node["as_leaf"]:
        parts.append('<span class="badge">按叶子展开</span>')
    return "".join(parts)


def _render_tree(root: Mapping | None, total: int, limit: int) -> tuple[str, int, int]:
    """渲染成嵌套 ``<details>``；返回 (html, 已展示节点数, 未展示节点数)。

    预算用尽后**整枝不渲染**（不是把某行截成半句），缺口在末尾统一交代：
    报告是摘要视图、excel 才是全量，所以允许不完整。
    """
    if root is None:
        return '<p class="empty">（没有可展示的结构行）</p>', 0, 0

    out: list[str] = []
    shown = 0

    def walk(node: Mapping, depth: int) -> None:
        nonlocal shown
        if shown >= limit:
            return
        shown += 1
        kids = node["children"]
        head = _node_html(node)
        if not kids or shown >= limit:
            out.append(f'<div class="line">{head}</div>')
            return
        opened = " open" if depth == 0 else ""     # 只展开根：深层默认收起，避免巨型 DOM
        out.append(f'<details class="node"{opened}><summary>{head}</summary>')
        out.append('<div class="kids">')
        for child in kids:
            walk(child, depth + 1)
        out.append("</div></details>")

    walk(root, 0)
    return "".join(out), shown, max(0, total - shown)


# ---------------------------------------------------------------- 问题清单

def _issues_html(issues, limit: int) -> tuple[str, int, int]:
    """按"文件 / 对象"（issue 的 ``target``）分组渲染；返回 (html, 已列条数, 未列条数)。"""
    groups: dict[str, list] = {}
    order: list[str] = []
    for item in issues or ():
        if not isinstance(item, Mapping):
            continue
        target = _text(item.get("target")) or "（未指明对象）"
        if target not in groups:
            groups[target] = []
            order.append(target)
        groups[target].append(item)

    total = sum(len(v) for v in groups.values())
    out: list[str] = []
    listed = 0
    for target in order:
        if listed >= limit:
            break
        rows: list[str] = []
        for item in groups[target]:
            if listed >= limit:
                break
            is_error = _text(item.get("level")) == "error"
            lv_cls = "lv lv--error" if is_error else "lv lv--warn"
            stage = " ".join(s for s in (_text(item.get("stage")),
                                         _text(item.get("stage_name"))) if s)
            rows.append(
                "<tr>"
                f'<td><span class="{lv_cls}">{_esc("错误" if is_error else "警告")}'
                f' {_esc(item.get("code"))}</span></td>'
                f"<td>{_esc(stage)}</td>"
                f'<td class="mono">{_esc(item.get("location"))}</td>'
                f'<td class="mono">{_esc(item.get("field"))}</td>'
                f"<td>{_esc(item.get('message'))}</td>"
                f"<td>{_esc(item.get('hint'))}</td>"
                "</tr>"
            )
            listed += 1
        if not rows:
            continue
        errors = sum(1 for i in groups[target] if _text(i.get("level")) == "error")
        warns = len(groups[target]) - errors
        stats = f"错误 {errors} / 警告 {warns}" if errors else f"警告 {warns}"
        out.append(
            f'<div class="grp"><h3>{_esc(target)}<span>{_esc(stats)}</span></h3>'
            "<table><thead><tr><th>级别 / 码</th><th>阶段</th><th>位置</th>"
            "<th>字段</th><th>说明</th><th>修复建议</th></tr></thead>"
            f"<tbody>{''.join(rows)}</tbody></table></div>"
        )
    return "".join(out), listed, max(0, total - listed)


# ---------------------------------------------------------------- 页面装配

def _cards(summary: Mapping, node_count: int) -> str:
    tree = summary.get("tree") or {}
    counts = summary.get("counts") or {}
    files = summary.get("files") or {}
    items = [
        ("结构行数", _num(tree.get("nodes")) or _num(node_count), ""),
        ("组件", _num(tree.get("components")), ""),
        ("最大层级", _num(tree.get("max_level")), ""),
        ("子BOM 文件", _num(files.get("total")), ""),
        ("错误", _num(counts.get("error")) or "0", ""),
        ("警告", _num(counts.get("warn")) or "0", ""),
        ("耗时", _num(summary.get("elapsed_s")), "s"),
    ]
    cards = []
    for label, value, unit in items:
        if value == "":
            continue
        suffix = f"<small>{_esc(unit)}</small>" if unit else ""
        cards.append(
            f'<div class="card"><div class="k">{_esc(label)}</div>'
            f'<div class="v">{_esc(value)}{suffix}</div></div>'
        )
    return "".join(cards)


def build_report(
    result: Mapping,
    *,
    merged_filename: str,
    job_id: str = "",
    generated_at: str | None = None,
) -> bytes:
    """生成报告（UTF-8 字节）。**不抛业务异常**：脏字段退化为空展示，不拦合并结果交付。

    ``result`` 是**内部**结果（含 ``_nodes`` 全量节点与全量 ``issues``）——
    对外 JSON 会把 issues 截到 ``max_issues``，报告则可以给得更多（仍受本模块上限约束）。
    """
    summary = result.get("summary") or {}
    nodes = result.get("_nodes") or []
    issues = result.get("issues") or []
    artifact = result.get("artifact") or {}
    total_nodes = len(nodes) if isinstance(nodes, list) else 0

    root_name = (_text(summary.get("root")) or _text(result.get("root"))
                 or "（未推断出根组件）")
    status = _text(result.get("status"))
    message = _text(result.get("message"))
    stamp = generated_at or datetime.now().strftime("%Y-%m-%d %H:%M")

    tree_html, shown, dropped = _render_tree(_tree(nodes), total_nodes, MAX_REPORT_NODES)
    issues_html, listed, hidden = _issues_html(issues, MAX_REPORT_ISSUES)

    tree_note = ""
    if dropped:
        tree_note = (
            f'<p class="more">共 {total_nodes} 行，报告内展开前 {shown} 行，'
            f"另有 {dropped} 行未展示（完整数据见合并后的 excel）。</p>"
        )
    issues_note = ""
    if hidden:
        issues_note = (
            f'<p class="more">共 {listed + hidden} 条，报告内列出前 {listed} 条，'
            f"另有 {hidden} 条未展示（完整清单见 excel 的「校验汇总」）。</p>"
        )
    issues_body = issues_html or '<p class="empty">没有问题：本次合并未记录任何错误或警告。</p>'

    meta_bits = [f"根组件 {_esc(root_name)}", f"生成于 {_esc(stamp)}"]
    if job_id:
        meta_bits.append(f"任务 {_esc(job_id)}")

    file_line = f"数据文件：<b>{_esc(merged_filename)}</b>"
    rows_text = _num(artifact.get("rows"))
    size_text = _size(artifact.get("bytes"))
    detail = " · ".join(s for s in (f"{rows_text} 行" if rows_text else "",
                                    size_text) if s)
    if detail:
        file_line += f"（{_esc(detail)}）"

    concl_cls = "concl" if status == "success" else "concl concl--bad"
    doc = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BOM 合并报告 · {_esc(root_name)}</title>
<style>{_CSS}</style>
</head>
<body>
<main>
  <header class="head">
    <h1>BOM 合并报告</h1>
    <p class="sub">{' · '.join(meta_bits)}</p>
    <p class="{concl_cls}">{_esc(message)}</p>
  </header>

  <section class="cards">{_cards(summary, total_nodes)}</section>

  <h2>合并结果</h2>
  <div class="panel">
    <p class="file">{file_line}</p>
    <p class="hint">下载请用聊天区下方的入口行，或右上角铃铛「后台记录」——
      本报告只是摘要视图，数据以那份 excel 为准。</p>
  </div>

  <h2>结构总览</h2>
  <div class="panel tree">{tree_html}{tree_note}</div>

  <h2>问题清单</h2>
  <div class="panel">{issues_body}{issues_note}</div>
</main>
</body>
</html>
"""
    return doc.encode("utf-8")
