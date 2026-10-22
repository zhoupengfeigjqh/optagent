# -*- coding: utf-8 -*-
"""BOM 合并服务 —— 可测核心逻辑（不依赖 mcp，不在导入期发网络请求）。

职责边界（与需求逐条对应）：
- **只做合并**：把一批单层子BOM（zip 打包）+ 顶层总成表递归展开、拍平成一棵多级总BOM，
  按 schema_path 产出 xlsx。
- **只校验"可合并性"**：输入能否取到、表能否解析、映射是否 1:1、编码能否唯一认领、
  树能否展开、数量能否连乘。
- **不做**与真实/参考BOM 的一致性比对（行序/数量/增删/版本差异）；`bom_integrate.validate()`
  整段不搬运。

分层（对齐 `ocr-service`）：
- `bom_core`：全部业务规则 + 结果形状 + 产出命名。不依赖 `mcp` ⇒ 单测可在宿主机直接跑。
- `server.py`：MCP 工具装配、传输选择，以及算完之后把产出**回写平台**（`resultUrl`）。

服务侧**不写磁盘**（2026-10-21）：合并产出的 xlsx 算完直接从内存 POST 给运行环境注入的
回写地址，由平台落进调用者的文件空间（`临时空间/后台产出/`）并返回权威路径 `filePath`。
计算全程 `io.BytesIO`，不落盘中转。两个工具都是**同步**的——没有受理、没有后台任务。

判据一致性：校验规则逐条对齐 `bom_integrate.py`，唯一改动是把 `print + sys.exit(1)`
换成返回 Issue 列表——一次性汇总，而不是遇错即崩。
"""
import io
import json
import os
import re
import time
import uuid
import zipfile
from collections.abc import Mapping
from urllib.parse import parse_qsl, unquote, urlsplit

import httpx
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font

# ---------------------------------------------------------------- 环境变量
# 导入期读取（与 ocr_core 同款），单测用 importlib.reload 切换取值。

# 单个输入（zip / 总BOM / json）下载上限
MAX_INPUT_BYTES = int(os.environ.get("BOM_MAX_INPUT_BYTES", str(20 * 1024 * 1024)))
# zip 解压后累计字节上限（防 zip bomb）
MAX_UNCOMPRESSED_BYTES = int(os.environ.get("BOM_MAX_UNCOMPRESSED_BYTES", str(200 * 1024 * 1024)))
# zip 内条目数上限
MAX_FILES = int(os.environ.get("BOM_MAX_FILES", "500"))
# 展开节点数上限（防 BOM 爆炸）
MAX_NODES = int(os.environ.get("BOM_MAX_NODES", "100000"))
# 回源下载超时（秒）
DOWNLOAD_TIMEOUT = float(os.environ.get("BOM_DOWNLOAD_TIMEOUT_S", "30"))
RESULT_SUFFIX_XLSX = ".xlsx"
XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# zip 内一律忽略的条目：macOS 资源叉、Excel 临时文件、隐藏项
ZIP_SKIP_PREFIXES = ("__MACOSX/",)
ZIP_SKIP_BASENAMES = ("__MACOSX",)
ZIP_SKIP_MARKERS = ("~$",)
EXCEL_EXTS = (".xls", ".xlsx")

# 文件名尾部的版本后缀（仅用于 root 推断：`WCCMT-00000B0570_00_0B` → `WCCMT-00000B0570`）
# 形如 `_00_0A` / `_00_0B`：下划线 + 数字 + 下划线 + 数字（可选版本字母）
VERSION_SUFFIX = re.compile(r"_\d{1,3}_\d{1,3}[A-Za-z]?$")

# 展开阶段的循环引用截断深度保护（真实 BOM 层级 ≤ 6，留足余量防脏数据递归爆栈）
MAX_DEPTH = 64

# 阶段名（Issue 的 stage_name，供人读）
STAGE_NAMES = {
    "S0": "输入与配置",
    "S1.2": "编码族识别",
    "S1.5": "表头列名1:1映射",
    "S2": "明细归一化",
    "S2.4": "文件内整行重复",
    "S2.5": "编码→文件认领",
    "S4": "递归展开",
    "S5": "累计用量计算",
    "S6": "导出",
}

#: 取值来源属于"本阶段可得"的字段（其余一律留空：人工维护 / 到料计划join / 派生）
VALUE_SOURCES = ("子BOM映射", "计算生成")


# ================================================================ 结果形状
# 成功与失败**同一形状**，只有 status 不同；调用方无需分支猜测。

RESULT_STATUS_SUCCESS = "success"
RESULT_STATUS_FAILED = "failed"


def issue(
    code,
    level,
    stage,
    message,
    target="",
    family="",
    location="",
    field="",
    evidence=None,
    hint="",
):
    """构造一条可定位的问题记录（校验失败/警告的统一载体）。"""
    return {
        "code": code,
        "level": level,
        "stage": stage,
        "stage_name": STAGE_NAMES.get(stage, stage),
        "target": target,
        "family": family,
        "location": location,
        "field": field,
        "message": message,
        "evidence": evidence or {},
        "hint": hint,
    }


def build_result(message, summary=None, issues=None, artifact=None):
    """标准 JSON 结果：status 只由 error 条数决定（WARN 必列但不改状态）。"""
    issues = issues or []
    errors = [i for i in issues if i["level"] == "error"]
    return {
        "status": RESULT_STATUS_FAILED if errors else RESULT_STATUS_SUCCESS,
        "message": message,
        "summary": summary or {},
        "issues": issues,
        "artifact": artifact,
    }


def failed_result(message, issues=None, *, root=None, artifact=None, stages_run=None):
    """**还没进管线**就失败时的标准结果（卡在 S0 / 输入取不到）。

    这时没有节点、没有列序、没有行数，但对外**形状必须与成功结果一致**——
    否则调用方要按 status 分支猜字段。这份"空骨架"只在这里定义一处，
    ``server.py`` 与 ``run_from_urls`` 都不再各自手拼 summary
    （对齐 ``ocr_core.failed_result``：结果形状由 core 独占，装配层不碰）。
    """
    issues = list(issues or [])
    stages = list(stages_run or ["S0"])
    summary = {
        "counts": {"error": sum(1 for i in issues if i["level"] == "error"),
                   "warn": sum(1 for i in issues if i["level"] == "warn")},
        "by_code": count_by(issues, "code"),
        "by_stage": count_by(issues, "stage"),
        "files": {"total": 0, "parsed": 0},
        "tree": {"nodes": 0, "components": 0, "max_level": 0, "as_leaf": 0},
        "column_order": [],
        "root": root,
        "stages_run": stages,
        "stopped_at": stages[-1],
        "elapsed_s": 0,
    }
    result = build_result(message, summary, issues, artifact=artifact)
    result["root"] = root
    return result


def result_json(result: Mapping) -> str:
    """结果的**标准 JSON 文本**（工具返回的就是它；成功与失败同一形状）。

    不转义非 ASCII：中文问题描述直接可读，也少传多余字节。
    """
    return json.dumps(result, ensure_ascii=False, default=str)


def count_by(issues, key):
    out = {}
    for i in issues:
        out[str(i.get(key) or "")] = out.get(str(i.get(key) or ""), 0) + 1
    return dict(sorted(out.items()))


def first_error_line(issues):
    """首个错误的可定位一行：`[目标] 说明`；无错误返回空串。"""
    for i in issues:
        if i["level"] == "error":
            return f"[{i['target']}] {i['message']}" if i["target"] else i["message"]
    return ""


# ================================================================ URL 与下载
# 与 ocr_core 同款：只验协议、限时、限大小；SSRF 的防线在**唯一的生产者**（平台铸造直链）。


def check_http_url(url) -> str | None:
    """校验地址协议；返回错误文案，``None`` 表示放行。

    四个文件入参都是平台铸造的直链。服务只接受 http/https：
    挡 `file:///etc/passwd` 这类非 HTTP 目标，也顺便挡住"模型/调用方直接填相对路径"。
    """
    if not isinstance(url, str) or not url.strip():
        return "错误：地址为空"
    try:
        u = urlsplit(url)
    except Exception:
        return "错误：无效的 URL"
    if u.scheme not in ("http", "https"):
        # 对外文案不提 http/https：工具签名给模型看到的是**相对路径**口径，这里只需讲清
        # "必须由平台铸造后注入"，避免「参数是相对路径」与「勿填相对路径」两种说法对冲。
        return "错误：该输入不是平台注入的下载地址（相对路径不会被服务自行解析，请勿手填）"
    return None


def download(url: str, transport: httpx.BaseTransport | None = None) -> bytes | str:
    """下载字节；失败返回错误文案（str）。

    不跟随重定向、限时、边下边判大小（先看 content-length，再累计实际字节）。

    :param transport: 仅供测试注入（如 ``httpx.MockTransport``），生产调用保持缺省。
    """
    err = check_http_url(url)
    if err:
        return err
    try:
        # 显式构造 Client：`httpx.stream()` 不暴露 transport，测试无法注入桩
        with httpx.Client(
            timeout=DOWNLOAD_TIMEOUT,
            follow_redirects=False,
            transport=transport,
        ) as client:
            with client.stream("GET", url) as r:
                if r.status_code != 200:
                    return f"错误：下载失败（HTTP {r.status_code}），签名可能已过期或文件不存在"
                length = r.headers.get("content-length")
                if length and int(length) > MAX_INPUT_BYTES:
                    return f"错误：输入超过上限 {MAX_INPUT_BYTES // 1024 // 1024}MB"
                chunks: list[bytes] = []
                total = 0
                for chunk in r.iter_bytes(64 * 1024):
                    total += len(chunk)
                    if total > MAX_INPUT_BYTES:
                        return f"错误：输入超过上限 {MAX_INPUT_BYTES // 1024 // 1024}MB"
                    chunks.append(chunk)
                return b"".join(chunks)
    except httpx.HTTPError as e:
        return f"错误：下载失败（{e.__class__.__name__}）"


def url_basename(url: str) -> str:
    """直链 → 文件名。

    优先取 query 的 `p=`（平台签名直链携带的相对路径）尾段，其次取 URL path 尾段。
    只用于 root 推断与产出命名，不参与业务判据。
    """
    if not isinstance(url, str) or not url:
        return ""
    try:
        u = urlsplit(url)
        q = dict(parse_qsl(u.query, keep_blank_values=True))
    except Exception:
        return ""
    cand = (q.get("p") or "").replace("\\", "/")
    if cand:
        tail = cand.rsplit("/", 1)[-1]
        if tail:
            return tail
    return unquote(u.path.rsplit("/", 1)[-1])


def file_key(name: str) -> str:
    """文件名 → 索引 key：**仅去扩展名，不截断版本后缀**（对齐 `load_all`）。"""
    base = name.rsplit("/", 1)[-1]
    stem, dot, _ext = base.rpartition(".")
    return stem if dot else base


def strip_version_suffix(key: str) -> str:
    """去掉尾部版本后缀（`WCCMT-00000B0570_00_0B` → `WCCMT-00000B0570`）。

    仅用于"从总BOM 文件名推断根组件编码"；索引 key 本身不做任何截断。
    """
    return VERSION_SUFFIX.sub("", key or "")


#: 总BOM 直链取不出文件名时的兜底名（`fetch_documents` 与 root 推断共用同一常量）
FALLBACK_TOTAL_BOM_NAME = "total_bom.xlsx"


def root_from_total_bom_name(total_bom_name: str, root: str | None = None) -> str:
    """由总BOM **文件名**推断根组件编码（显式 ``root`` 优先）。

    **管线与产出命名共用这一处实现**：产出名（``artifact_filename``）里的 root 必须与
    BOM 表里的根组件一致；那边若另写一份推断，迟早会漂移成"文件名说一个、表里是另一个"。
    """
    return root or strip_version_suffix(file_key(total_bom_name))


def root_from_total_bom_url(total_bom_url: str, root: str | None = None) -> str:
    """同上，但入参是**直链**——还没下载到文件时只能从地址里取名字。"""
    return root_from_total_bom_name(url_basename(total_bom_url) or FALLBACK_TOTAL_BOM_NAME, root)


# ================================================================ 任务号与产出名


def make_job_id(now: float | None = None) -> str:
    """生成任务号：``bom_<毫秒时间戳>_<随机 8 位>``。

    时间戳在前便于人眼排序与排查；随机后缀使产出**不可猜**——下载端点无鉴权，
    URL 就是凭证，这是那条链路上唯一的安全来源。
    """
    stamp = int((now if now is not None else time.time()) * 1000)
    return f"bom_{stamp}_{uuid.uuid4().hex[:8]}"


def artifact_filename(job_id: str, root: str = "") -> str:
    """合并产出的**文件名**（既是回写时的文件名，也是聊天区入口的显示名）。

    同一个名字贯穿两处：回写时作为 ``filename``（平台据此算 ``job_id`` 与落盘名），返回时
    作为 ``filePathName``——不需要"按 job_id 反查展示名"的 sidecar（少一个可能与正文漂移的
    状态）。``root`` 由**与管线同一处**的推断函数给出，因此不会出现"文件名里的根组件与表里
    的根组件对不上"。
    """
    safe_root = re.sub(r"[^0-9A-Za-z_.-]", "_", root) or "BOM"
    return f"总BOM_{safe_root}_{job_id}{RESULT_SUFFIX_XLSX}"


# ================================================================ S0 输入与配置
def norm_name(s) -> str:
    """列名归一化：合并所有连续空白（含换行）为单空格（对齐 `norm_name`）。"""
    return " ".join(str(s).split())


def loads_json(data: bytes):
    """解析 JSON 字节；返回 (对象, err文案)。错误文案由调用方补上目标字段名。"""
    try:
        return json.loads(data.decode("utf-8-sig")), None
    except UnicodeDecodeError as e:
        return None, f"不是合法 UTF-8 文本（{e.__class__.__name__}）"
    except json.JSONDecodeError as e:
        return None, f"JSON 语法错误（第 {e.lineno} 行 第 {e.colno} 列：{e.msg}）"


def check_schema_order(schema, issues, target="schema_path"):
    """校验 excel_column_order 自洽（这是"输出列 100% 由 schema 驱动"的前提）。"""
    order = schema.get("excel_column_order")
    if not isinstance(order, list) or not order:
        issues.append(issue(
            "E005a", "error", "S0",
            "schema 缺少可用的 excel_column_order（必须是非空字符串数组）",
            target=target, field="excel_column_order",
            hint="在 总BOM标准字段.json 补 excel_column_order，列出要输出的字段名及顺序",
        ))
        return []
    order = [c for c in order if isinstance(c, str) and c.strip()]
    undefined = [c for c in order if not isinstance(schema.get(c), Mapping)]
    if undefined:
        issues.append(issue(
            "E005b", "error", "S0",
            f"excel_column_order 中有 {len(undefined)} 个字段在 schema 中没有定义",
            target=target, field="excel_column_order",
            evidence={"undefined": undefined},
            hint="为这些字段补字段定义，或把它们从 excel_column_order 移除",
        ))
    dup = sorted({c for c in order if order.count(c) > 1})
    if dup:
        issues.append(issue(
            "E005c", "error", "S0",
            f"excel_column_order 存在重复列名：{', '.join(dup)}",
            target=target, field="excel_column_order", evidence={"duplicates": dup},
            hint="同一个字段只能出现一次（否则会输出两列同名）",
        ))
    defined = [k for k, v in schema.items() if isinstance(v, Mapping) and "name_cn" in v]
    not_output = [k for k in defined if k not in order]
    if not_output:
        issues.append(issue(
            "W005", "warn", "S0",
            f"schema 中定义了但不在 excel_column_order 的字段不会输出：{', '.join(not_output)}",
            target=target, field="excel_column_order", evidence={"not_output": not_output},
            hint="如需输出，把它们加入 excel_column_order",
        ))
    no_cn = [c for c in order if isinstance(schema.get(c), Mapping) and not schema[c].get("name_cn")]
    if no_cn:
        issues.append(issue(
            "W006", "warn", "S0",
            f"这些输出列缺 name_cn，表头回退为字段名：{', '.join(no_cn)}",
            target=target, field="excel_column_order", evidence={"no_name_cn": no_cn},
        ))
    mismatch = []
    for idx, c in enumerate(order):
        col = schema.get(c, {}).get("col")
        if c in dup:
            continue                      # 重复项已由 E005c 报出，不再叠一条位置告警
        if isinstance(col, int) and col != idx:
            mismatch.append({"field": c, "index_in_order": idx, "col": col})
    if mismatch:
        issues.append(issue(
            "W007", "warn", "S0",
            f"{len(mismatch)} 个字段的 col 与 excel_column_order 位置不一致",
            target=target, field="excel_column_order", evidence={"mismatch": mismatch},
            hint="以 excel_column_order 为唯一列序真源；建议同步修正 col 属性",
        ))
    return order


def component_patterns(mapping, issues, target="mapping_path"):
    """可选配置 `_missing_component.patterns`：判定"该编码本应有子BOM 文件"的正则清单。

    **缺省为空**（不做 W402 提示）——用"编码族前缀"当判据会把叶子件一起误判
    （实测：`VCPM6B2EH9001` 这类叶子件与 `VCPM…ZE` 组件同前缀），噪音淹没信号。
    因此把这条判据交给配置：只有命中正则的编码才提示"未找到子BOM，按叶子展开"。
    """
    cfg = mapping.get("_missing_component")
    if cfg is None:
        return []
    if not isinstance(cfg, Mapping):
        issues.append(issue("E015", "error", "S0",
                            "_missing_component 形状非法（应为对象，含 patterns 数组）",
                            target=target, field="_missing_component",
                            hint='写成 {"patterns": ["^WCCUN-\\\\d+-S$"]}'))
        return []
    pats = []
    for p in cfg.get("patterns") or []:
        if not isinstance(p, str) or not p.strip():
            continue
        try:
            pats.append(re.compile(p))
        except re.error as e:
            issues.append(issue("E015", "error", "S0",
                                f"_missing_component.patterns 里的正则非法：{p}（{e.msg}）",
                                target=target, field="_missing_component",
                                hint="修正正则语法后重新上传映射表"))
    return pats


def check_mapping(mapping, issues, target="mapping_path"):
    """校验子BOM字段映射：至少一个族字典 + _header_detect 形状合法。"""
    fams = {
        k: v for k, v in mapping.items()
        if isinstance(v, Mapping) and not k.startswith("_") and k not in ("description", "source_file")
    }
    if not fams:
        issues.append(issue(
            "E006", "error", "S0",
            "子BOM字段映射里没有任何编码族字典（VCPM/WCXXX/WCCMT/WCCUN）",
            target=target,
            hint="为每个编码族补一个『列名→标准字段』字典",
        ))
    detect = mapping.get("_header_detect")
    if not isinstance(detect, Mapping) or not isinstance(detect.get("keywords"), list) or not detect["keywords"]:
        issues.append(issue(
            "E007", "error", "S0",
            "_header_detect 缺失或形状非法（需要 keywords 非空数组）",
            target=target, field="_header_detect",
            hint="补 _header_detect：{\"max_scan_rows\": 12, \"keywords\": [\"DISEGNO\", \"DRAWING\", \"CODICE\"]}",
        ))
    return fams


def load_config(schema, mapping, issues):
    """由两份 JSON 组装运行配置（判据全部派生，不硬编码字段/族/行位）。"""
    families = {
        k: {norm_name(h): f for h, f in v.items()}
        for k, v in check_mapping(mapping, issues).items()
    }
    order = check_schema_order(schema, issues)
    detect = mapping.get("_header_detect") if isinstance(mapping.get("_header_detect"), Mapping) else {}
    cfg = {
        "families": families,
        "header_detect": {"max_scan_rows": int(detect.get("max_scan_rows") or 12),
                          "keywords": list(detect.get("keywords") or [])},
        "schema": schema,
        "column_order": order,
        # 可选：判定"该编码本应有子BOM 文件"的正则（缺省空 = 不提示 W402）
        "component_patterns": component_patterns(mapping, issues),
        # 子BOM必须1:1覆盖的标准字段 = schema 中 source=='子BOM映射' 的字段（**派生**）
        "required_fields": {k for k, v in schema.items()
                            if isinstance(v, Mapping) and v.get("source") == "子BOM映射"},
    }
    return cfg


# ================================================================ zip 与读表
def read_zip_members(data: bytes, issues, target: str = "sub_bom_zip_path"):
    """内存解压 zip -> [(文件名, 字节)]；只取 excel 成员，大小/条目数双重上限。"""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        issues.append(issue("E002", "error", "S0", "zip 无法打开（文件损坏或不是 zip）",
                            target=target, hint="请重新打包为标准 zip 后再提交"))
        return []
    except Exception as e:
        issues.append(issue("E002", "error", "S0", f"zip 无法打开（{e.__class__.__name__}）", target=target))
        return []
    members, total_bytes, seen = [], 0, {}
    try:
        infos = zf.infolist()
    finally:
        pass
    if len(infos) > MAX_FILES:
        issues.append(issue("E013", "error", "S0",
                            f"zip 内条目数 {len(infos)} 超过上限 {MAX_FILES}",
                            target=target, evidence={"count": len(infos), "limit": MAX_FILES}))
        zf.close()
        return []
    for info in infos:
        name = info.filename.replace("\\", "/")
        base = name.rsplit("/", 1)[-1]
        if name.startswith(ZIP_SKIP_PREFIXES) or base in ZIP_SKIP_BASENAMES or base.startswith("."):
            continue
        if any(m in base for m in ZIP_SKIP_MARKERS):
            continue
        if not base.lower().endswith(EXCEL_EXTS):
            continue
        total_bytes += info.file_size
        if total_bytes > MAX_UNCOMPRESSED_BYTES:
            issues.append(issue("E012", "error", "S0",
                                f"zip 解压后累计 {total_bytes // 1024 // 1024}MB 超过上限 "
                                f"{MAX_UNCOMPRESSED_BYTES // 1024 // 1024}MB",
                                target=target,
                                evidence={"bytes": total_bytes, "limit": MAX_UNCOMPRESSED_BYTES}))
            zf.close()
            return []
        key = base
        if key in seen:
            issues.append(issue("E010", "error", "S0",
                                f"zip 内出现同名文件「{key}」，索引会互相覆盖",
                                target=target, evidence={"first": seen[key], "second": name},
                                hint="每个编码只保留一个文件（同名文件请去掉目录重复项）"))
            continue
        seen[key] = name
        members.append((base, zf.read(info)))
    zf.close()
    if not members:
        issues.append(issue("E003", "error", "S0", "zip 内没有任何 .xls/.xlsx 子BOM 文件",
                            target=target,
                            hint="请把全部子BOM excel 直接打包进 zip（不要只放目录）"))
    return members


def read_workbook(data: bytes, sheet_name: str | None = None):
    """内存读表 -> (sheet 名列表, 行列表, err)。

    .xls 走 xlrd、.xlsx 走 openpyxl（pandas 按文件头自动选引擎），全程 BytesIO。
    """
    try:
        xl = pd.ExcelFile(io.BytesIO(data))
    except Exception as e:
        return [], [], f"无法读取（{e.__class__.__name__}: {e}）"
    names = [str(n) for n in xl.sheet_names]
    target = sheet_name or (names[0] if names else None)
    if target is None:
        return names, [], "工作簿内没有工作表"
    if target not in names:
        return names, [], f"工作表「{target}」不存在"
    try:
        df = xl.parse(target, header=None, dtype=object)
    except Exception as e:
        return names, [], f"工作表「{target}」解析失败（{e.__class__.__name__}）"
    rows = df.where(pd.notna(df), None).values.tolist()
    return names, rows, None


# ================================================================ S1.2 编码族识别
def family_of(key: str, families):
    """文件名 key → 编码族（族前缀由 mapping 顶级 key 派生，不硬编码）。"""
    for fam in families:
        if key.startswith(fam):
            return fam
    return None


def check_families(skipped, cfg, issues):
    """存在无法归入任何族的子BOM → E101（对齐 `precheck_families`）。"""
    if not skipped:
        return
    issues.append(issue(
        "E101", "error", "S1.2",
        f"{len(skipped)} 个子BOM 文件名无法识别编码族",
        target=", ".join(skipped[:5]) + ("…" if len(skipped) > 5 else ""),
        evidence={"skipped": skipped, "families": sorted(cfg["families"])},
        hint="若为新族，请在 子BOM字段映射.json 补充该族的映射字典；若为误放文件，请移出 zip",
    ))


# ================================================================ S1.5 表头映射
def find_header_row(rows, detect_cfg):
    """前 max_scan_rows 行内，第 0 列归一化后含任一关键词即为标题行（对齐 `find_header_row`）。"""
    for r in range(min(int(detect_cfg["max_scan_rows"]), len(rows))):
        first = norm_name(rows[r][0] or "") if rows[r] else ""
        if any(k in first for k in detect_cfg["keywords"]):
            return r
    return None


def build_colmap(header_cells, fam_dict):
    """标题行 -> ({列位置: 标准字段}, 未匹配列名列表)（对齐 `build_colmap`）。"""
    colmap, unmatched = {}, []
    for c, cellv in enumerate(header_cells):
        if cellv is None or not str(cellv).strip():
            continue
        fld = fam_dict.get(norm_name(cellv))
        if fld:
            colmap[c] = fld
        else:
            unmatched.append(f"列{c}:{norm_name(cellv)}")
    return colmap, unmatched


def check_headers(raw, cfg, issues):
    """逐文件检查表头必须与 source=子BOM映射 字段形成 1:1 映射（对齐 `precheck_headers`）。"""
    required = cfg["required_fields"]
    for key, rf in raw.items():
        rows, fname, fam = rf["rows"], rf["file_name"], rf["family"]
        hdr = find_header_row(rows, cfg["header_detect"])
        if hdr is None:
            issues.append(issue(
                "E102", "error", "S1.5",
                f"找不到标题行（前 {cfg['header_detect']['max_scan_rows']} 行第 0 列不含 "
                f"{'/'.join(cfg['header_detect']['keywords'])}）",
                target=fname, family=fam, location="第 1~%d 行 第 0 列" % cfg["header_detect"]["max_scan_rows"],
                evidence={"keywords": cfg["header_detect"]["keywords"]},
                hint="修正源表表头，或在 子BOM字段映射.json 的 _header_detect 放宽关键词/扫描行数",
            ))
            continue
        colmap, unmatched = build_colmap(rows[hdr], cfg["families"][fam])
        missing = sorted(required - set(colmap.values()))
        location = f"表头行 第{hdr + 1}行"
        if missing:
            issues.append(issue(
                "E103", "error", "S1.5",
                f"必需字段未集齐（缺: {', '.join(missing)}）",
                target=fname, family=fam, location=location, field=", ".join(missing),
                evidence={"matched": sorted(set(colmap.values())), "unmatched": unmatched,
                          "required_fields": sorted(required)},
                hint=f"请在 子BOM字段映射.json 的 {fam} 族中补充这些字段对应的源表列名",
            ))
        elif unmatched:
            issues.append(issue(
                "E104", "error", "S1.5",
                f"存在 {len(unmatched)} 个未识别列",
                target=fname, family=fam, location=location,
                evidence={"unmatched": unmatched},
                hint=f"若该列有效，请在 子BOM字段映射.json 的 {fam} 族中补充映射；若为脏数据/错列，请修正源表",
            ))


# ================================================================ S2 明细归一化
def normalize(raw, cfg, issues):
    """raw -> items_by_key {文件名key: [Item]}；Item 的 key = 标准字段（对齐 `normalize`）。"""
    items_by_key = {}
    for key, rf in raw.items():
        rows, fname, fam = rf["rows"], rf["file_name"], rf["family"]
        hdr = find_header_row(rows, cfg["header_detect"])
        if hdr is None:
            continue                      # E102 已报；S1.5 有 error 时不会走到这里
        colmap, _ = build_colmap(rows[hdr], cfg["families"][fam])
        descr_cols = [c for c, f in colmap.items() if f == "descr"]
        items = []
        for r in range(hdr + 1, len(rows)):
            row = rows[r]

            def get(f):
                for c, cf in colmap.items():
                    if cf == f and c < len(row) and row[c] is not None:
                        return row[c]
                return None

            code = get("mat_code")
            posiz_raw = get("posiz")
            code_text = "" if code is None else str(code).strip().upper()
            if not code_text and (posiz_raw is None or not str(posiz_raw).strip()):
                # mat_code 与 posiz **都**空 = 表内空行/填充行 → 跳过（源表空行很多）。
                # 但"mat_code 空、posiz 有值"是**合法明细行**：外购/标准件（螺钉、垫圈、
                # 传感器…）源表不写图号，只以 SIGLA/描述标识位置；源表与人工参考总表里
                # 都存在这样的行（实测 WCCUN-0000147236/147248/147250）。此时必须保留，
                # 否则整行数据连同数量被静默丢弃。这类行 mat_code 留空、下游按叶子零件展开。
                continue
            descr_parts = [str(row[c]).strip() for c in sorted(descr_cols)
                           if c < len(row) and row[c] is not None and str(row[c]).strip()]
            qty_raw = get("qty")
            try:
                qty = float(qty_raw)
                qty = int(qty) if qty == int(qty) else qty
            except (TypeError, ValueError):
                qty = qty_raw
                issues.append(issue(
                    "W301", "warn", "S2",
                    f"qty 非数值：{qty_raw!r}",
                    target=fname, family=fam, location=f"第{r + 1}行", field="qty",
                    evidence={"mat_code": code_text},
                    hint="修正该行数量（保留原值继续，累计用量将无法计算）",
                ))
            item = {}
            for f in set(colmap.values()):
                if f == "mat_code":
                    item[f] = code_text
                elif f == "descr":
                    item[f] = " ".join(descr_parts)
                elif f == "qty":
                    item[f] = qty
                else:
                    v = get(f)
                    item[f] = "" if v is None else str(v).strip()
            items.append(item)
        items_by_key[key] = items
    return items_by_key


def check_duplicates(items_by_key, raw, issues):
    """同一子BOM 内整行重复（全部字段相同）→ E201（对齐 `precheck_duplicates`）。"""
    for key, items in items_by_key.items():
        seen = {}
        for idx, item in enumerate(items):
            sig = tuple(sorted((k, str(v)) for k, v in item.items()))
            if sig in seen:
                issues.append(issue(
                    "E201", "error", "S2.4",
                    f"第{seen[sig] + 1}条 与 第{idx + 1}条 整行完全重复",
                    target=raw[key]["file_name"], family=raw[key]["family"],
                    location=f"明细第{seen[sig] + 1}条 / 第{idx + 1}条",
                    evidence={k: item[k] for k in ("mat_code", "posiz", "qty", "descr") if k in item},
                    hint="删除源表重复行后重新提交",
                ))
            else:
                seen[sig] = idx


def build_resolver(raw, items_by_key, root, issues):
    """从根节点逐层做 编码→唯一文件key 的认领（对齐 `build_resolver`）。

    候选 = 所有"文件名等于编码、或以编码开头"的文件；某编码候选 ≥2 → E202（版本冲突），
    不做精确优先；候选 0 → 不解析（下游按叶子处理）。
    """
    keys = list(raw.keys())
    resolver, conflicts = {}, {}
    visited = set()
    queue = [root]
    while queue:
        code = queue.pop(0)
        if code not in resolver:
            cands = [k for k in keys if k == code or k.startswith(code)]
            if len(cands) > 1:
                conflicts.setdefault(code, sorted(cands))
                continue
            if not cands:
                continue
            resolver[code] = cands[0]
        fkey = resolver[code]
        if fkey in visited:
            continue
        visited.add(fkey)
        for item in items_by_key.get(fkey, []):
            # 编码留空的明细行（外购/标准件）不参与认领：空串会被 `startswith("")`
            # 判成"匹配所有文件"——单文件时静默认错、多文件时报假 E202 版本冲突。
            if item["mat_code"]:
                queue.append(item["mat_code"])
    for code, cands in sorted(conflicts.items()):
        issues.append(issue(
            "E202", "error", "S2.5",
            f"编码 {code} 匹配到 {len(cands)} 个文件（版本冲突）",
            target=code, location="编码→文件认领",
            evidence={"candidates": [raw[k]["file_name"] for k in cands]},
            hint="每个编码只保留一个版本文件后重新打包",
        ))
    return resolver


# ================================================================ S4 递归展开
def expand(key, level, path, items_by_key, resolver, out, issues, cfg, node_base=None, depth=0):
    """DFS 先序展开（对齐 `expand`）：组件节点行 = 父件里的那一行，随后紧跟它的子件。

    数量不在这里乘 —— Node 上只存单层 qty，连乘交给 S5。
    """
    base = node_base or {}
    node = dict(base)
    node.update({
        "level": level,
        "mat_code": base.get("mat_code", key),
        "posiz": base.get("posiz", ""),
        "qty": base.get("qty", 1),
        "descr": base.get("descr", ""),
        "unit_attr": "UNIT" if level == 1 else "",
        "is_component": True,
        "source_key": key,
        "as_leaf": False,
    })
    out.append(node)
    if depth > MAX_DEPTH or len(out) > MAX_NODES:
        return out
    for item in items_by_key.get(key, []):
        child = item["mat_code"]
        # 编码留空的行认领不到文件（resolver 里没有空 key），自然落到叶子分支，
        # posiz/qty/descr 等原样带出——保留行、也不误报"缺子BOM 文件"。
        child_key = resolver.get(child)
        if child_key is not None and child_key in path:
            issues.append(issue(
                "W401", "warn", "S4",
                f"循环引用截断：{'/'.join(path)} -> {child}",
                target=item.get("source_key") or key, location="递归展开",
                evidence={"path": sorted(path), "child": child},
                hint="核查源表中互为父子的两行",
            ))
            continue
        if child_key is not None:
            expand(child_key, level + 1, path | {key}, items_by_key, resolver, out,
                   issues, cfg, node_base=item, depth=depth + 1)
        else:
            # 无对应子BOM 文件：按叶子零件展开；命中配置的组件正则才提示 W402
            as_leaf = any(p.search(child) for p in cfg.get("component_patterns") or ())
            if as_leaf:
                issues.append(issue(
                    "W402", "warn", "S4",
                    f"未找到子BOM 文件，按叶子零件展开：{child}",
                    target=base.get("mat_code", key), location=f"posiz={item.get('posiz', '')}",
                    field=child,
                    hint="如该编码本应有下级，请把它的子BOM 补进 zip",
                ))
            out.append(dict(item, level=level + 1,
                            unit_attr="UNIT" if level + 1 == 1 else "",
                            is_component=False, source_key=key, as_leaf=as_leaf))
    return out


# ================================================================ S5 累计用量
def calc_total_qty(nodes, order_units, issues):
    """单趟栈算法 O(n)：total_qty(n) = qty(n) × total_qty(parent(n))（对齐 `calc_total_qty`）。"""
    if not nodes:
        return nodes
    nodes[0]["total_qty"] = order_units
    stack = [order_units]
    for node in nodes[1:]:
        stack = stack[:node["level"]]
        parent_total = stack[node["level"] - 1]
        try:
            node["total_qty"] = node["qty"] * parent_total
        except TypeError:
            node["total_qty"] = None
            issues.append(issue(
                "W501", "warn", "S5",
                f"累计用量无法计算（qty 非数值）：{node.get('mat_code')}",
                target=node.get("source_key", ""), field=str(node.get("mat_code")),
                hint="修正该行单层用量",
            ))
        stack.append(node["total_qty"] if node["is_component"] and node["total_qty"] else 0)
    return nodes


# ================================================================ S6 导出
def export_xlsx(nodes, schema, column_order, issues) -> bytes:
    """按 schema 输出 xlsx（**列集合/列序/表头/留空判据 100% 由 schema_path 驱动**）。

    - 列序 = excel_column_order；表头 = 各字段 name_cn
    - source ∈ {子BOM映射, 计算生成} → 填值；其余（人工维护/到料join/派生）→ 留空
    - level 缩进；组件行加粗；"按叶子展开"的组件 mat_code 红字
    - 追加 `校验汇总` sheet（错误码/级别/阶段/文件/位置/字段/说明/修复建议）
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "Total BOM"
    ws.append([schema.get(c, {}).get("name_cn", c) for c in column_order])
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for node in nodes:
        row = []
        for c in column_order:
            src = schema.get(c, {}).get("source", "")
            row.append(node.get(c, "") if src in VALUE_SOURCES else None)
        ws.append(row)
        r = ws.max_row
        ws.cell(row=r, column=1).alignment = Alignment(indent=int(node.get("level") or 0))
        if node.get("as_leaf"):
            for c in range(1, len(column_order) + 1):
                ws.cell(row=r, column=c).font = Font(bold=True, color="FF0000")
        elif node.get("is_component"):
            for c in range(1, len(column_order) + 1):
                ws.cell(row=r, column=c).font = Font(bold=True)
    for col, w in {"A": 26, "F": 40, "G": 22, "H": 16}.items():
        ws.column_dimensions[col].width = w
    ws2 = wb.create_sheet("校验汇总")
    ws2.append(["错误码", "级别", "阶段", "文件/对象", "位置", "字段", "说明", "修复建议"])
    for cell in ws2[1]:
        cell.font = Font(bold=True)
    for i in issues:
        ws2.append([i["code"], i["level"], f"{i['stage']} {i['stage_name']}", i["target"],
                    i["location"], i["field"], i["message"], i["hint"]])
    for col, w in {"A": 10, "B": 7, "C": 20, "D": 32, "E": 18, "F": 18, "G": 52, "H": 52}.items():
        ws2.column_dimensions[col].width = w
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ================================================================ 编排
def run_pipeline(
    *,
    zip_bytes: bytes,
    total_bom_bytes: bytes,
    schema_obj: Mapping,
    mapping_obj: Mapping,
    total_bom_name: str,
    root: str | None = None,
    order_units: float = 1.0,
    total_bom_sheet: str | None = None,
    emit: bool = False,
) -> dict:
    """完整管线：S0 → S1.2 → S1.5 → S2 → S2.4 → S2.5 → S4 → S5 →（S6 导出）。

    任一阶段出现 error 即停止（fail-fast），`stopped_at` 写明卡点——
    与 `bom_integrate.py` 各预检 `sys.exit(1)` 的语义一致。

    :param total_bom_name: 输入2 的文件名（去扩展名前的原名），用于索引 key 与 root 推断
    :param emit: True = 通过校验后导出 xlsx（组装工具）；False = dry-run（校验工具）
    """
    issues: list[dict] = []
    stages_run: list[str] = []
    started = time.time()

    def stage(name):
        stages_run.append(name)

    def errors():
        return [i for i in issues if i["level"] == "error"]

    # ---------------- S0 配置 ----------------
    stage("S0")
    cfg = load_config(schema_obj, mapping_obj, issues)
    root_key = file_key(total_bom_name)
    root = root_from_total_bom_name(total_bom_name, root)
    if not root:
        issues.append(issue("E009", "error", "S0", "无法确定根组件编码（root 未传且总BOM 文件名推断不出）",
                            target=total_bom_name, hint="显式传入 root（如 WCCMT-00000B0570）"))
    # 总BOM（顶层总成表）与 zip 内的子BOM 同一套解析规则，一并并入索引
    raw = {root_key: {"file_name": total_bom_name, "family": None, "rows": []}}
    names, rows, err = read_workbook(total_bom_bytes, total_bom_sheet)
    if err:
        msg = f"总BOM 无法读取：{err}"
        if "不存在" in err and names:
            msg += f"；可用工作表：{', '.join(names)}"
        issues.append(issue("E008" if "不存在" not in err else "E011", "error", "S0", msg,
                            target=total_bom_name, field="total_bom_sheet",
                            evidence={"available_sheets": names},
                            hint="确认 total_bom_sheet 与文件内容；留空则取第一个工作表"))
    else:
        raw[root_key]["rows"] = rows
        raw[root_key]["family"] = family_of(root_key, cfg["families"])
    if errors():
        return _finish_result(issues, stages_run, cfg, {}, root, time.time() - started, xlsx=None)

    # ---------------- S1.2 编码族识别 ----------------
    stage("S1.2")
    members = read_zip_members(zip_bytes, issues)
    skipped = []
    for name, content in members:
        key = file_key(name)
        fam = family_of(key, cfg["families"])
        if fam is None:
            skipped.append(name)
            continue
        _, m_rows, m_err = read_workbook(content)
        if m_err:
            issues.append(issue("E003", "error", "S0", f"zip 内文件无法读取：{m_err}",
                                target=name, hint="确认是完整未加密的 .xls/.xlsx"))
            continue
        if key in raw and key != root_key:
            issues.append(issue("E010", "error", "S0", f"索引中已存在同名文件「{key}」",
                                target=name, hint="每个编码只保留一个文件"))
            continue
        raw[key] = {"file_name": name, "family": fam, "rows": m_rows}
    check_families(skipped, cfg, issues)
    if raw[root_key]["family"] is None and root_key not in skipped:
        pass  # 总BOM 无法归族时由 E101 覆盖（下面统一判断）
    if raw[root_key]["family"] is None:
        issues.append(issue("E101", "error", "S1.2", "总BOM 文件名无法识别编码族",
                            target=total_bom_name, evidence={"families": sorted(cfg["families"])},
                            hint="总BOM 文件名应以某个族前缀开头（如 WCCMT-…）"))
    if errors():
        return _finish_result(issues, stages_run, cfg, raw, root, time.time() - started, xlsx=None)

    # ---------------- S1.5 表头 1:1 映射 ----------------
    stage("S1.5")
    check_headers(raw, cfg, issues)
    if errors():
        return _finish_result(issues, stages_run, cfg, raw, root, time.time() - started, xlsx=None)

    # ---------------- S2 归一化 ----------------
    stage("S2")
    items_by_key = normalize(raw, cfg, issues)

    # ---------------- S2.4 整行重复 ----------------
    stage("S2.4")
    check_duplicates(items_by_key, raw, issues)
    if errors():
        return _finish_result(issues, stages_run, cfg, raw, root, time.time() - started, xlsx=None)

    # ---------------- S2.5 编码认领 ----------------
    stage("S2.5")
    resolver = build_resolver(raw, items_by_key, root, issues)
    if root not in resolver:
        issues.append(issue("E203", "error", "S2.5", f"根节点 {root} 没有对应的子BOM 文件",
                            target=root, evidence={"resolvable": len(resolver)},
                            hint="确认总BOM 文件名/root 参数与 zip 内容一致"))
    if errors():
        return _finish_result(issues, stages_run, cfg, raw, root, time.time() - started, xlsx=None)

    # ---------------- S4 展开 / S5 连乘 ----------------
    stage("S4")
    nodes = expand(resolver[root], 0, set(), items_by_key, resolver, [], issues, cfg)
    if len(nodes) > MAX_NODES:
        issues.append(issue("E014", "error", "S4", f"展开节点数 {len(nodes)} 超过上限 {MAX_NODES}",
                            evidence={"nodes": len(nodes), "limit": MAX_NODES},
                            hint="确认子BOM 是否互相引用成环或数量异常"))
        return _finish_result(issues, stages_run, cfg, raw, root, time.time() - started, xlsx=None)
    stage("S5")
    calc_total_qty(nodes, order_units, issues)

    # ---------------- S6 导出 ----------------
    xlsx = None
    if emit:
        stage("S6")
        if errors():
            return _finish_result(issues, stages_run, cfg, raw, root, time.time() - started, xlsx=None)
        try:
            xlsx = export_xlsx(nodes, cfg["schema"], cfg["column_order"], issues)
        except Exception as e:
            issues.append(issue("E701", "error", "S6", f"导出失败（{e.__class__.__name__}: {e}）",
                                hint="多为 schema 字段定义异常；核对 type/name_cn 后重试"))
        if errors():
            xlsx = None
    return _finish_result(issues, stages_run, cfg, raw, root, time.time() - started, xlsx=xlsx, nodes=nodes)


def _finish_result(issues, stages_run, cfg, raw, root, elapsed, xlsx=None, nodes=None):
    """把管线状态整理成标准结果（统计 + issues + 是否可交付）。"""
    errors = [i for i in issues if i["level"] == "error"]
    warns = [i for i in issues if i["level"] == "warn"]
    nodes = nodes or []
    summary = {
        "counts": {"error": len(errors), "warn": len(warns)},
        "by_code": count_by(issues, "code"),
        "by_stage": count_by(issues, "stage"),
        "files": {"total": len(raw), "parsed": len(raw)},
        "tree": {
            "nodes": len(nodes),
            "components": sum(1 for n in nodes if n.get("is_component")),
            "max_level": max((n.get("level") or 0 for n in nodes), default=0),
            "as_leaf": sum(1 for n in nodes if n.get("as_leaf")),
        },
        "column_order": list(cfg.get("column_order") or []),
        "root": root,
        "stages_run": stages_run,
        "stopped_at": stages_run[-1] if errors and stages_run else None,
        "elapsed_s": round(elapsed, 2),
    }
    if errors:
        message = (f"校验未通过：{len(errors)} 项错误、{len(warns)} 项警告。"
                   f"首个错误：{first_error_line(issues)}。"
                   f"注意：本结果仅表示能否合并，不代表已与真实BOM 核对一致。")
    elif xlsx is not None:
        message = (f"合并完成：{len(nodes)} 行（含根 {root}），组件 "
                   f"{summary['tree']['components']} 个，警告 {len(warns)} 条。"
                   f"注意：本结果仅表示已成功合并，不代表已与真实BOM 核对一致。")
    else:
        message = (f"校验通过：{summary['files']['total']} 个子BOM、展开 {len(nodes)} 行、"
                   f"警告 {len(warns)} 条（未发现阻断性错误）。"
                   f"注意：本结果仅表示可成功合并，不代表已与真实BOM 核对一致。")
    result = build_result(message, summary, issues, artifact=None)
    result["root"] = root
    result["_nodes"] = nodes
    result["_xlsx"] = xlsx
    return result


def public_result(result: Mapping, *, filename: str = "", bytes_len: int = 0, rows: int = 0) -> dict:
    """剥掉内部字段，补上 artifact。

    - ``artifact``：本次产出的文件名/行数/字节数；没有产出（校验、或合并被阻断）时置 ``None``；
    - 视图入口（``filePath`` / ``filePathName``）**不在这里拼**：它只能在回写成功之后由
      ``server.py`` 补上（平台返回的 ``path`` 才是权威路径）；拼不出就不写，
      契约 §4.7 的缺失语义是"本次没有入口"（界面整行不渲染）。
    """
    out = {k: v for k, v in result.items() if not k.startswith("_")}
    if filename:
        out["artifact"] = {"filename": filename, "rows": rows, "bytes": bytes_len}
    else:
        out["artifact"] = None
    return out


def fetch_documents(
    *,
    sub_bom_zip: str,
    total_bom: str,
    schema_url: str,
    mapping_url: str,
    transport: httpx.BaseTransport | None = None,
):
    """下载四个输入（内存），返回 (docs, issues)。

    形参名保持 `*_url`——**值就是平台铸造的下载直链**（"相对路径"是对外工具签名那一层的
    口径，见 `server.py` 文件头；映射在 `server._pipeline_kwargs`）。

    每个输入独立报错：一个取不到不影响"其余输入的取到情况也一并呈现"，
    便于使用者一次性看到全部问题（而不是修一个再跑一次）。
    """
    issues: list[dict] = []
    docs = {}
    # 元组第一项是**对外参数名**：它进 `issue["target"]` / `issue["field"]`，也是 json 输入的
    # docs key（结构见下方分支）。对外口径是相对路径（`*_path`，平台在调用前铸成直链），
    # 所以这里与形参名（`*_url`，值确实是下载直链）**故意不同**，转换点仅此一处。
    for field_name, url, kind in (
        ("sub_bom_zip_path", sub_bom_zip, "zip"),
        ("total_bom_path", total_bom, "excel"),
        ("schema_path", schema_url, "json"),
        ("mapping_path", mapping_url, "json"),
    ):
        data = download(url, transport=transport)
        if isinstance(data, str):
            issues.append(issue(
                "E001", "error", "S0",
                f"输入 {field_name} 取不到：{data}",
                target=field_name, field=field_name,
                evidence={"url_tail": url_basename(url)},
                hint="确认文件已上传到文件空间、该输入已由平台注入（相对路径不会自动生效）且签名未过期",
            ))
            continue
        if kind == "json":
            obj, err = loads_json(data)
            if err:
                issues.append(issue("E004", "error", "S0",
                                    f"{field_name} 不是合法 JSON：{err}",
                                    target=url_basename(url) or field_name, field=field_name,
                                    hint="修正 JSON 语法后重新上传"))
                continue
            docs[field_name] = obj
        elif kind == "zip":
            docs["zip_bytes"] = data
        else:
            docs["total_bom_bytes"] = data
            docs["total_bom_name"] = url_basename(url) or FALLBACK_TOTAL_BOM_NAME
    return docs, issues


def run_from_urls(
    *,
    sub_bom_zip: str,
    total_bom: str,
    schema_url: str,
    mapping_url: str,
    root: str | None = None,
    order_units: float = 1.0,
    total_bom_sheet: str | None = None,
    emit: bool = False,
    transport: httpx.BaseTransport | None = None,
) -> dict:
    """下载 + 跑管线（服务与单测共用的完整入口，**不落盘**）。

    入参名保持 `*_url`：值就是平台铸造的下载直链（对外工具签名的相对路径口径见 `server.py`）。
    """
    docs, issues = fetch_documents(
        sub_bom_zip=sub_bom_zip, total_bom=total_bom,
        schema_url=schema_url, mapping_url=mapping_url, transport=transport,
    )
    if issues:
        return failed_result(
            f"校验未通过：{len(issues)} 项错误。首个错误：{first_error_line(issues)}。",
            issues, root=root)
    return run_pipeline(
        zip_bytes=docs["zip_bytes"],
        total_bom_bytes=docs["total_bom_bytes"],
        schema_obj=docs["schema_path"],
        mapping_obj=docs["mapping_path"],
        total_bom_name=docs["total_bom_name"],
        root=root, order_units=order_units,
        total_bom_sheet=total_bom_sheet, emit=emit,
    )
