# -*- coding: utf-8 -*-
"""BOM MCP 服务：FastMCP（streamable-http），工具**全同步**。

对外只有两件能力：

- ``bom_validate``：校验一批子BOM 能否合并（dry-run，**不产文件**）；
- ``bom_merge``：合并成多级总BOM，产出 **xlsx + HTML 报告两个文件**，**算完立刻回写平台**，
  返回两条入口（``filePath`` = 报告，``mergedFile`` = xlsx）——都落进调用者的文件空间
  （``临时空间/后台产出/``），用户从聊天区入口点开即看/即下载。

为什么回写而不是自己存（2026-10-21 改）：xlsx 是二进制，只能靠 URL 交付，而"用户能打开的那个
URL"只有平台铸得出来（HMAC 密钥在平台侧，契约也禁止服务自行拼接平台入口地址）。所以本服务
**不再落盘、不再自铸下载地址**：运行环境为声明了 ``resultUrl`` 的工具注入回写地址
（``POST /api/files/put``），服务算完把字节 POST 过去，平台落盘后回 ``path``，服务把它原样作为
``filePath`` 返回（契约 §4.7 的本地文件空间形态）。

为什么两个文件（2026-10-22 改）：结构树与问题清单需要"能读"的载体，塞进 JSON 正文会挤占模型
上下文且没人读得下去。报告是 HTML（见 ``report.py``：纯 ``<details>``、无脚本、无外链），
xlsx 仍是数据本体。**同一个 resultUrl 可以 POST 多次**（平台不消费签名），每次换 ``filename``
即落一条产出记录——所以"一次调用两条入口"不需要平台改任何东西。

分工：业务规则在 ``bom_core``（不依赖 ``mcp``，可脱离 MCP 装配单测）、报告渲染在 ``report``
（纯函数）；本文件只做 MCP 装配与那两次回写。没有 ``resultUrl`` 时**不给任何假地址**——
结果照常返回，只是本次没有可点入口。
"""
import functools
import os
import sys
import urllib.parse
from typing import Annotated

import anyio
import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import Field

from bom_core import (
    artifact_filename,
    failed_result,
    issue,
    make_job_id,
    public_result,
    result_json,
    root_from_total_bom_url,
    run_from_urls,
)
from report import build_report, report_filename

# 监听端口 8000（与 ocr-service 一致）。两个 MCP 服务同号**不冲突**：各自在容器里有独立
# 网络命名空间；只有同机裸跑或 host 网络部署时才需要给其中一个设 BOM_MCP_PORT 覆盖。
# 端到端测试据此在任意空闲端口起服务，不受本机已占用端口影响（部署时不必设置）
_PORT = int(os.environ.get("BOM_MCP_PORT", "8000"))

mcp = FastMCP("bom", host="0.0.0.0", port=_PORT)

# 工具声明有两条，都有实测依据：
#
# 1) 工具函数写成 **async def** + ``anyio.to_thread.run_sync`` 跑计算。
#    代价必须知情（反而写同步 `def` 才是坑）：FastMCP 只对 async 函数做 `await`，
#    同步函数会被**直接在事件循环里调用**（见 mcp/server/fastmcp/utilities/func_metadata.py
#    的 `call_fn_with_arg_validation`，非 async 分支就是 `return fn(**kwargs)`）——
#    也就是说计算期间整个服务的事件循环被占住，真实数据实测约 2 秒，期间并发会话与健康
#    检查都得一起等。同步工具（本服务两个工具都是"算完才返回"）更要避免这一点，
#    所以统一 `await anyio.to_thread.run_sync(...)`：对外契约完全不变，事件循环不再被占用。
#
# 2) `@mcp.tool(structured_output=False)`——不要省略这个开关：
#    本环境（mcp 1.26 + pydantic 2.10）保留结构化输出时，`-> str` 会走 FastMCP 的
#    `_create_wrapped_model(func_name, str)` → `create_model(name, result=str)`，
#    pydantic 2.10 当场抛：
#        PydanticUserError: A non-annotated attribute was detected: `result = <class 'str'>`
#    ⇒ **工具注册失败、服务起不来**（实测，见 tests/test_server_params.py）。
#    关掉结构化输出后，`-> str` 回归"纯文本结果"，与本服务契约完全一致
#    （工具返回的就是标准 JSON 文本）。

#: 四个文件参数的共用说明（对外一律是相对路径口径：由平台在发起调用前自动铸造/注入）
_PATH_DOC = "文件空间相对路径，由平台自动注入"
# 参数命名注意（踩过的坑，勿改回去）：
# 两个配置参数命名为 `schema_path` / `mapping_path` 而不是 `schema_json` / `mapping_json`——
# `schema_json` 与 pydantic `BaseModel.schema_json` 方法重名，FastMCP 的规避逻辑会把它改名为
# `field_schema_json` 并加 alias，而本环境（pydantic 2.10）下别名不生效 ⇒ 任何调用都会
# 因"缺少 schema_json"而失败。参数名一律避开 BaseModel 的既有属性（dict/json/copy/schema/schema_json…）。
#
# 对外名与 core 侧名的分工（**两边都要保留，不要"统一"掉**）：
# 工具签名向模型暴露的是**相对路径**（`*_path`）；平台按 `file_args` 声明把它铸成签名下载直链
# 后才会真正发起调用 ⇒ 进到 `_pipeline_kwargs` / `bom_core` 的值仍是 http(s) 直链，所以 core
# 侧参数保持 `*_url` 命名（那一层确实在处理 URL：下载、取 basename）。转换只在
# `_pipeline_kwargs` 这一处做。


#: 回写的整体超时（秒）：平台在本机/同网段，落盘是写文件，正常几十毫秒
_PUT_TIMEOUT_S = float(os.environ.get("BOM_PUT_TIMEOUT_S", "30"))
#: 单次回写的字节上限。平台 ``/api/files/put`` 的 bodyLimit = ``UPLOAD_MAX_MB``（默认 5MB，超限 413）：
#: 先判大小是为了**不白传一遍**（契约 §4.6 明确要求"结果可能很大时先判大小"）。
#: 平台侧若调大该上限，这里用 ``BOM_RESULT_MAX_BYTES`` 跟上即可。
_MAX_RESULT_BYTES = int(os.environ.get("BOM_RESULT_MAX_BYTES", str(5 * 1024 * 1024)))


def _put_url(result_url: str, filename: str, summary: str) -> str:
    """在回写地址上追加 ``filename`` / ``summary``：**保留原有 query**（契约 §4.3）。

    必须走 URL 解析器而不是字符串拼 ``&``：地址可能已带 query（``u/d/exp/sig/sid/call_id/t``），
    拼字符串在带 fragment 或空 query 的形态下会拼出非法 URL，而丢掉任何一个原有参数都会 403。
    """
    parts = urllib.parse.urlsplit(result_url)
    query = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    query.append(("filename", filename))
    if summary:
        query.append(("summary", summary))
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(query), parts.fragment))


def _deliver(result_url: str, filename: str, data: bytes, summary: str) -> tuple[str, str]:
    """把产出**回写平台**（``POST /api/files/put``）；返回 ``(filePath, 失败说明)``。

    成功时 ``filePath`` = 平台返回的 ``path``（形如 ``临时空间/后台产出/{会话}_{产出名}``），
    它是**权威路径**——服务不自己拼。失败时返回空串 + 一行原因：调用方据此**不写 filePath**
    （契约 §4.7：不带 = 本次没有入口），而不是编一个点不开的路径。
    """
    if len(data) > _MAX_RESULT_BYTES:
        return "", (f"产出 {len(data)} 字节，超过回写上限 {_MAX_RESULT_BYTES} 字节"
                    f"（平台 bodyLimit；可用 BOM_RESULT_MAX_BYTES 对齐）")
    try:
        # content-type **必须是 octet-stream**：平台只为 `application/octet-stream` / `text/plain`
        # 注册了"原样收字节"的 parser（见 agent-backend `server.ts`），
        # 发 xlsx 自己的 MIME 会被 Fastify 判 415 Unsupported Media Type。
        resp = httpx.post(_put_url(result_url, filename, summary), content=data,
                          headers={"content-type": "application/octet-stream"},
                          timeout=_PUT_TIMEOUT_S, follow_redirects=False)
    except Exception as e:                                  # noqa: BLE001 —— 网络异常绝不穿透成 500
        return "", f"回写请求失败（{e.__class__.__name__}: {e}）"
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


def _pipeline_kwargs(sub_bom_zip_path, total_bom_path, schema_path, mapping_path,
                     total_bom_sheet, root, order_units, *, emit):
    """组装 ``run_from_urls`` 的入参（两个工具共用；``emit`` 区分是否导出 xlsx）。

    这里同时是**对外参数名 → core 参数名**的唯一转换点：工具侧收的是相对路径口径
    （`*_path`），而 ``run_from_urls`` 那层的参数名是 `*_url`（值确实已是平台铸造的
    下载直链）。改名映射只在这一处，避免 core 层被"路径"口径污染。
    """
    return {
        "sub_bom_zip": sub_bom_zip_path,
        "total_bom": total_bom_path,
        "schema_url": schema_path,
        "mapping_url": mapping_path,
        "root": root,
        "order_units": order_units,
        "total_bom_sheet": total_bom_sheet,
        "emit": emit,
    }


def _report_bytes(internal: dict, merged_filename: str, job_id: str) -> bytes | None:
    """生成报告字节；**任何异常都收敛成 ``None``**。

    报告是"附加视图"：它出不来只能少一条入口，绝不能让已经算好的数据文件跟着交不出去
    （原则九：降级不阻断，且原因落 stderr 供运维定位）。
    """
    try:
        return build_report(internal, merged_filename=merged_filename, job_id=job_id)
    except Exception as e:                                  # noqa: BLE001
        print(f"合并报告生成失败：{e.__class__.__name__}: {e}", file=sys.stderr)
        return None


def _report_summary(internal: dict) -> str:
    """报告那条产出记录的摘要（铃铛「后台记录」里与数据文件那条区分开）。"""
    summary = internal.get("summary") or {}
    tree = summary.get("tree") or {}
    counts = summary.get("counts") or {}
    return (f"合并报告：{tree.get('nodes', 0)} 行，"
            f"错误 {counts.get('error', 0)} / 警告 {counts.get('warn', 0)}")


def _deliver_outputs(result_url: str, *, filename: str, xlsx: bytes, internal: dict,
                     job_id: str, summary: str) -> tuple[dict, str]:
    """两次回写（数据文件 → 报告），返回 ``(入口字段, 要附加到 message 的说明)``。

    **键序即展示顺序**：``filePath`` / ``filePathName``（报告）在前、``mergedFile``（xlsx）在后
    —— 平台按 JSON 键的顺序深度优先抽取入口行（`agent-backend/src/domain/view-links.ts`）。

    降级链（原则九）：每一档都保住上一档已经交付的东西
    1. 数据文件回写失败 → **无任何入口**（``{}``），原因进说明（不编假路径）；
    2. 报告生成/回写失败 → 顶层退回**数据文件**，且**不给** ``mergedFile``
       （同一路径不给两条入口，否则界面上会出现两行一模一样的链接）。
    """
    data_path, err = _deliver(result_url, filename, xlsx, summary)
    if err:
        print(f"产出回写失败（{filename}）：{err}", file=sys.stderr)
        return {}, f"产出未交付：{err}"

    data_entry = {"filePath": data_path, "filePathName": filename}
    report = _report_bytes(internal, filename, job_id)
    if report is None:
        return data_entry, "报告未生成，仅提供数据文件"

    report_name = report_filename(filename)
    report_path, report_err = _deliver(result_url, report_name, report,
                                       _one_line(_report_summary(internal)))
    if report_err:
        print(f"合并报告回写失败（{report_name}）：{report_err}", file=sys.stderr)
        return data_entry, f"报告未交付，仅提供数据文件：{report_err}"

    return ({"filePath": report_path, "filePathName": report_name, "mergedFile": data_entry},
            "")


def _run(kind, kwargs, *, filename: str = "",
         max_issues: int | None = None) -> tuple[dict, bytes, dict]:
    """跑管线 → ``(对外结果, 待交付字节, 内部结果)``。**不落盘、也不铸地址**——那是调用方的事。

    ``filename`` 是产出的文件名（只有合并没有被阻断时才有意义）：给了就写进 ``artifact``，
    没给（校验、或合并被阻断）则 ``artifact`` 为 ``None`` —— 绝不给一个查不到的文件名。

    第三个返回值是**未剥壳**的内部结果：报告要全量 ``_nodes`` 与全量 ``issues``
    （对外 JSON 的 issues 会被 ``max_issues`` 截断，但报告不该跟着缩水）。
    """
    try:
        result = run_from_urls(**kwargs)
    except Exception as e:                                  # 兜底：绝不让异常穿透成 500
        issues = [issue("E999", "error", "S0", f"内部错误（{e.__class__.__name__}: {e}）",
                        hint="请把该报错与本次输入一并反馈给服务维护者")]
        result = failed_result(f"内部错误：{e.__class__.__name__}", issues)

    rows = (result.get("summary") or {}).get("tree", {}).get("nodes", 0)
    xlsx = result.get("_xlsx") if kind == "merge" else None
    public = public_result(result, filename=filename if xlsx else "",
                           bytes_len=len(xlsx or b""), rows=rows)
    if max_issues is not None and len(public.get("issues") or []) > max_issues:
        total = len(public["issues"])
        public["issues"] = public["issues"][:max_issues]
        public["message"] = f"{public['message']}（仅列出前 {max_issues} 条，共 {total} 条）"
    return public, (xlsx or b""), result


@mcp.tool(title="BOM 校验", structured_output=False)
async def bom_validate(
    sub_bom_zip_path: Annotated[
        str,
        Field(title="子BOM 压缩包", description=f"子BOM 打包 zip，{_PATH_DOC}"),
    ],
    total_bom_path: Annotated[
        str,
        Field(title="总BOM 表格", description=f"总BOM（顶层总成表）excel，{_PATH_DOC}"),
    ],
    schema_path: Annotated[
        str,
        Field(title="标准字段文件", description=f"总BOM标准字段.json，{_PATH_DOC}"),
    ],
    mapping_path: Annotated[
        str,
        Field(title="字段映射文件", description=f"子BOM字段映射.json，{_PATH_DOC}"),
    ],
    total_bom_sheet: Annotated[
        str | None,
        Field(
            title="总BOM 工作表名",
            description='总BOM 的工作表名（如 "WCCMT-00000B0570-B包"）。留空取第一个工作表；'
            "指定的表不存在时报错并列出全部可用表名",
        ),
    ] = None,
    root: Annotated[
        str | None,
        Field(
            title="根组件编码",
            description="根组件编码（如 WCCMT-00000B0570）。留空则由总BOM 文件名去掉版本后缀推断",
        ),
    ] = None,
    order_units: Annotated[
        float,
        Field(title="订单台数", description="订单台数；累计用量 total_qty 的连乘基数，默认 1"),
    ] = 1.0,
    max_issues: Annotated[
        int,
        Field(title="问题条目上限", description="返回的问题条目上限（默认 200），超出只给前 N 条并注明总数"),
    ] = 200,
) -> str:
    """校验一批子BOM 能否合并成一棵完整的多级总BOM（**dry-run，不产出 BOM 文件**）。

    检查项（判据与既有实现严格一致，逐条带错误码、文件、行号/列位与修复建议）：
    - S0  输入取不到 / zip 损坏或空 / zip 内同名冲突 / 配置 JSON 非法 / schema 列序不自洽 /
          总BOM 工作表不存在 / root 无法确定
    - S1.2 子BOM 文件名无法识别编码族
    - S1.5 找不到标题行 / 必需字段未集齐 / 存在未识别列（1:1 映射要求）
    - S2 / S2.4 / S2.5 qty 非数值 / 文件内整行重复 / 编码匹配到多个文件（版本冲突）
    - S4 / S5 循环引用截断 / 无子BOM 文件按叶子展开 / 累计用量无法计算

    **本工具不产出任何文件**：校验汇总本身就是结果，它自己就是 JSON，不需要下载通道。
    所以返回里恒有 ``"artifact": null``，也**没有** ``filePath``。

    返回 {"status":"success"|"failed","message":"一行结论","summary":{统计},"issues":[...],"artifact":null}
    其中 issues 每条含 code/level/stage/target/location/field/message/hint，便于直接定位。

    注意：**只判断"能不能合并"**，不做与真实BOM 的一致性比对；两者不要混用。
    """
    # `anyio.to_thread.run_sync` 只接位置参数 ⇒ 关键字用 functools.partial 收进去
    public, _bytes, _internal = await anyio.to_thread.run_sync(
        functools.partial(
            _run, "validate",
            _pipeline_kwargs(sub_bom_zip_path, total_bom_path, schema_path, mapping_path,
                             total_bom_sheet, root, order_units, emit=False),
            max_issues=max_issues))
    return result_json(public)


@mcp.tool(title="BOM 合并", structured_output=False)
async def bom_merge(
    sub_bom_zip_path: Annotated[
        str,
        Field(title="子BOM 压缩包", description=f"子BOM 打包 zip，{_PATH_DOC}"),
    ],
    total_bom_path: Annotated[
        str,
        Field(title="总BOM 表格", description=f"总BOM（顶层总成表）excel，{_PATH_DOC}"),
    ],
    schema_path: Annotated[
        str,
        Field(title="标准字段文件", description=f"总BOM标准字段.json，{_PATH_DOC}"),
    ],
    mapping_path: Annotated[
        str,
        Field(title="字段映射文件", description=f"子BOM字段映射.json，{_PATH_DOC}"),
    ],
    total_bom_sheet: Annotated[
        str | None,
        Field(
            title="总BOM 工作表名",
            description="总BOM 的工作表名。留空取第一个工作表；指定不存在时报错并列出全部可用表名",
        ),
    ] = None,
    root: Annotated[
        str | None,
        Field(title="根组件编码", description="根组件编码。留空则由总BOM 文件名去掉版本后缀推断"),
    ] = None,
    order_units: Annotated[
        float,
        Field(title="订单台数", description="订单台数；累计用量 total_qty 的连乘基数，默认 1"),
    ] = 1.0,
    max_issues: Annotated[
        int,
        Field(
            title="问题条目上限",
            description="返回的问题条目上限（默认 20）。更完整的清单见合并报告与 xlsx 的 `校验汇总` sheet",
        ),
    ] = 20,
    resultUrl: Annotated[
        str | None,
        Field(
            title="结果回写地址",
            description=(
                "产出回写地址。**由运行环境自动注入，请勿自行填写**；"
                "留空（默认）时只返回统计、不交付文件"
            ),
        ),
    ] = None,
) -> str:
    """把一批子BOM 合并成一棵多级总BOM，按 schema_path 输出 xlsx，并**写入调用者的文件空间**。

    流程（**同步**：调用返回时结果已经算完、文件也已经交付）：
    先跑与 ``bom_validate`` **同一个**校验函数 →
    - 有阻断性错误：**不产出 BOM**（避免半成品被误用），返回 ``status: "failed"`` + 问题清单，
      没有 ``filePath``（没有文件可下载）；
    - 无阻断性错误：按 schema_path 的 excel_column_order 输出 17 列 xlsx
      （列集合/列序/表头/留空判据 100% 由 schema_path 驱动，代码不硬编码列），
      组件行加粗、mat_code 按层级缩进、"无子BOM 按叶子展开"的行标红，
      并附一个 `校验汇总` sheet；另外生成一份 **HTML 合并报告**（结构树可折叠 + 问题清单）。

    产出交付：**两个文件**都通过运行环境注入的 ``resultUrl`` **回写到文件空间**
    （落点 ``临时空间/后台产出/``），因此返回**两条入口**：
    - ``filePath`` / ``filePathName`` → 报告（点开即读，聊天区第一行）；
    - ``mergedFile: {filePath, filePathName}`` → xlsx（点开即下载）。
    两者都是**文件空间的相对路径**（可直接交给 ``read_file`` / 文件空间接口），也都是平台给的
    **权威路径**——本服务不自己拼。报告里**刻意不含下载链接**：`.html` 在平台是以
    ``sandbox=""`` 内联预览的，下载/脚本都被沙箱关掉，真正的下载入口是平台渲染的那一行。

    返回形状（与校验一致，同一份 JSON）：
    status/message/summary/issues/artifact（+ 回写成功时的 filePath/filePathName/mergedFile）。
    其中 ``summary`` 就是这次合并的汇总统计：``tree.nodes``（行数）/``tree.components``（组件数）
    /``counts``（error/warn 条数）/``by_code``/``by_stage``/``files``/``elapsed_s`` 等。

    注意：**只负责合并**，不做与真实BOM 的一致性比对。
    """
    kwargs = _pipeline_kwargs(sub_bom_zip_path, total_bom_path, schema_path, mapping_path,
                              total_bom_sheet, root, order_units, emit=True)
    job_id = make_job_id()
    # 产出名里的 root 用**与管线同一处**的推断函数算出来，所以文件名与表里的根组件必然一致
    filename = artifact_filename(job_id, root_from_total_bom_url(total_bom_path, root))
    public, xlsx, internal = await anyio.to_thread.run_sync(
        functools.partial(_run, "merge", kwargs, filename=filename, max_issues=max_issues))
    if not xlsx:                                            # 合并被阻断 / 内部错误：没有文件
        return result_json(public)
    if not resultUrl:
        # 没拿到回写地址（直接调用服务 / 平台未注入）：结果照给，但本次**没有可点入口**
        public["message"] = f"{public['message']}（未收到回写地址，产出未写入文件空间）"
        return result_json(public)
    # 回写（两个文件，含降级链）同样放线程里：httpx 是同步客户端，不能在事件循环上等
    entries, note = await anyio.to_thread.run_sync(
        functools.partial(_deliver_outputs, resultUrl, filename=filename, xlsx=xlsx,
                          internal=internal, job_id=job_id,
                          summary=_one_line(public.get("message") or "")))
    public.update(entries)                     # 键序即展示顺序（报告在前，mergedFile 在后）
    if note:
        public["message"] = f"{public['message']}（{note}）"
    return result_json(public)


def main() -> None:
    """启动：以 streamable-http 跑起来（本服务**不写磁盘**，没有本地产出目录）。"""
    # 日志走 stderr：stdout 留给运行时（uvicorn 自身也往 stderr 打），运维重定向单一流即可
    print(f"BOM MCP 服务启动：streamable-http http://0.0.0.0:{_PORT}；"
          f"产出（xlsx + HTML 报告）经 resultUrl 回写平台"
          f"（单次上限 {_MAX_RESULT_BYTES // 1024 // 1024}MB）",
          file=sys.stderr, flush=True)
    mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()
