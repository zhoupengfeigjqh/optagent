# -*- coding: utf-8 -*-
"""BOM MCP 服务：FastMCP（streamable-http），工具**全同步**。

对外只有两件能力：

- ``bom_validate``：校验一批子BOM 能否合并（dry-run，**不产文件**）；
- ``bom_merge``：合并成多级总BOM，产出 xlsx，并返回一个**能点开的下载地址**
  （``{base}/files/{产出名}``）——用户从聊天区入口点开即下载。

为什么服务自己铸地址：xlsx 是二进制，只能靠 URL 交付；平台的签名读直链**只有平台铸得出来**
（HMAC 密钥在平台侧，契约也禁止服务自行拼接平台入口地址）。于是服务自管产出：算完落盘到
产出目录（默认 ``.data``，见 ``bom_store``），自己拼出地址，平台按契约 §4.7 把它渲染成
聊天区入口行（前端已有实现）。

分工：业务规则在 ``bom_core``、产出落盘与铸址在 ``bom_store``（两者都不依赖 ``mcp``，
可脱离 MCP 装配单测）；本文件只做 MCP 装配与那条下载路由。
"""
import functools
import os
import sys
from typing import Annotated

import anyio
from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field
from starlette.requests import Request
from starlette.responses import FileResponse, Response

import bom_store
from bom_core import (
    XLSX_CONTENT_TYPE,
    artifact_filename,
    failed_result,
    issue,
    make_job_id,
    public_result,
    result_json,
    root_from_total_bom_url,
    run_from_urls,
    url_basename,
)

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


def _base_url(ctx: Context | None = None) -> str:
    """产出地址的对外基址：``BOM_PUBLIC_BASE_URL`` 优先 → 请求的 scheme+Host → 空串。

    **只走 HTTP 传输**（本服务唯一的传输方式）：下载路由挂在 Starlette 应用上，只有
    进程真的在监听端口时它才存在 ⇒ "能不能给出可点链接"与"进程有没有 HTTP 服务"是同一件事。
    没拿到请求（例如单测直接调用工具函数）时不猜，只认显式配置；
    铸不出基址就返回空串，调用方据此**不写 viewUrl**（契约 §4.7：不带 = 本次没有入口）。
    """
    request = getattr(getattr(ctx, "request_context", None), "request", None)
    if request is None:
        return bom_store.base_from_request(bom_store.PUBLIC_BASE_URL)
    return bom_store.base_from_request(
        bom_store.PUBLIC_BASE_URL,
        host=request.headers.get("host"),
        scheme=request.url.scheme,
        forwarded_proto=request.headers.get("x-forwarded-proto"),
    )


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


def _run(kind, kwargs, *, filename: str = "", max_issues: int | None = None) -> tuple[dict, bytes]:
    """跑管线 → ``(对外结果, 待交付字节)``。**不落盘、也不铸地址**——那是调用方的事。

    ``filename`` 是产出的文件名（只有合并没有被阻断时才有意义）：给了就写进 ``artifact``，
    没给（校验、或合并被阻断）则 ``artifact`` 为 ``None`` —— 绝不给一个查不到的文件名。
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
    return public, (xlsx or b"")


@mcp.custom_route(f"{bom_store.URL_PREFIX}/{{name}}", methods=["GET"])
async def download(request: Request) -> Response:
    """产出下载：用户从聊天区的入口点进来，落到这里取 xlsx。

    - 只服务 ``bom_store`` 认得出的产出名（单段、后缀白名单）⇒ 无路径穿越；
    - 找不到 / 已过期 → 404（过期的文件顺手删掉，见 ``bom_store.resolve``）；
    - 下载名就是产出名本身：URL 里带着它，用户存下来的文件仍是
      ``总BOM_WCCMT-00000B0570_bom_…xlsx``，不用再改名（Starlette 会把中文名按 RFC 5987
      编码进 ``Content-Disposition``）。
    """
    name = request.path_params.get("name", "")
    path = bom_store.resolve(name)
    if path is None:
        return Response("产出不存在或已过期", status_code=404,
                        media_type="text/plain; charset=utf-8")
    return FileResponse(path, media_type=XLSX_CONTENT_TYPE, filename=name)


@mcp.tool(structured_output=False)
async def bom_validate(
    sub_bom_zip_path: Annotated[str, Field(description=f"子BOM 打包 zip，{_PATH_DOC}")],
    total_bom_path: Annotated[str, Field(description=f"总BOM（顶层总成表）excel，{_PATH_DOC}")],
    schema_path: Annotated[str, Field(description=f"总BOM标准字段.json，{_PATH_DOC}")],
    mapping_path: Annotated[str, Field(description=f"子BOM字段映射.json，{_PATH_DOC}")],
    total_bom_sheet: Annotated[
        str | None,
        Field(description='总BOM 的工作表名（如 "WCCMT-00000B0570-B包"）。留空取第一个工作表；'
                          "指定的表不存在时报错并列出全部可用表名"),
    ] = None,
    root: Annotated[
        str | None,
        Field(description="根组件编码（如 WCCMT-00000B0570）。留空则由总BOM 文件名去掉版本后缀推断"),
    ] = None,
    order_units: Annotated[float, Field(description="订单台数；累计用量 total_qty 的连乘基数，默认 1")] = 1.0,
    max_issues: Annotated[int, Field(description="返回的问题条目上限（默认 200），超出只给前 N 条并注明总数")] = 200,
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
    所以返回里恒有 ``"artifact": null``，也**没有** ``viewUrl``。

    返回 {"status":"success"|"failed","message":"一行结论","summary":{统计},"issues":[...],"artifact":null}
    其中 issues 每条含 code/level/stage/target/location/field/message/hint，便于直接定位。

    注意：**只判断"能不能合并"**，不做与真实BOM 的一致性比对；两者不要混用。
    """
    # `anyio.to_thread.run_sync` 只接位置参数 ⇒ 关键字用 functools.partial 收进去
    public, _bytes = await anyio.to_thread.run_sync(
        functools.partial(
            _run, "validate",
            _pipeline_kwargs(sub_bom_zip_path, total_bom_path, schema_path, mapping_path,
                             total_bom_sheet, root, order_units, emit=False),
            max_issues=max_issues))
    return result_json(public)


@mcp.tool(structured_output=False)
async def bom_merge(
    sub_bom_zip_path: Annotated[str, Field(description=f"子BOM 打包 zip，{_PATH_DOC}")],
    total_bom_path: Annotated[str, Field(description=f"总BOM（顶层总成表）excel，{_PATH_DOC}")],
    schema_path: Annotated[str, Field(description=f"总BOM标准字段.json，{_PATH_DOC}")],
    mapping_path: Annotated[str, Field(description=f"子BOM字段映射.json，{_PATH_DOC}")],
    total_bom_sheet: Annotated[
        str | None,
        Field(description="总BOM 的工作表名。留空取第一个工作表；指定不存在时报错并列出全部可用表名"),
    ] = None,
    root: Annotated[
        str | None,
        Field(description="根组件编码。留空则由总BOM 文件名去掉版本后缀推断"),
    ] = None,
    order_units: Annotated[float, Field(description="订单台数；累计用量 total_qty 的连乘基数，默认 1")] = 1.0,
    max_issues: Annotated[
        int,
        Field(description="返回的问题条目上限（默认 20）。完整问题清单在产出 xlsx 的 `校验汇总` sheet 里"),
    ] = 20,
    ctx: Context | None = None,
) -> str:
    """把一批子BOM 合并成一棵多级总BOM，按 schema_path 输出 xlsx，并给出**下载地址**。

    流程（**同步**：调用返回时结果已经算完并交付）：
    先跑与 ``bom_validate`` **同一个**校验函数 →
    - 有阻断性错误：**不产出 BOM**（避免半成品被误用），返回 ``status: "failed"`` + 问题清单，
      没有 ``viewUrl``（没有文件可下载）；
    - 无阻断性错误：按 schema_path 的 excel_column_order 输出 17 列 xlsx
      （列集合/列序/表头/留空判据 100% 由 schema_path 驱动，代码不硬编码列），
      组件行加粗、mat_code 按层级缩进、"无子BOM 按叶子展开"的行标红，
      并附一个 `校验汇总` sheet。

    产出交付：xlsx 落盘到本服务的产出目录（``BOM_ARTIFACT_DIR``，默认 ``.data``），
    返回 ``viewUrl`` + ``viewUrlName``；平台据此在聊天区渲染入口行，**用户点开即下载**。
    地址由**本服务**铸造（``/files/{产出名}``），凭证就是那个不可猜的文件名；
    文件按 ``BOM_ARTIFACT_TTL_S``（默认 7 天）清理，**过期后链接会失效**。

    返回形状（与校验一致，同一份 JSON）：
    status/message/summary/issues/artifact（+ 成功且有产出通道时的 viewUrl/viewUrlName）。
    其中 ``summary`` 就是这次合并的汇总统计：``tree.nodes``（行数）/``tree.components``（组件数）
    /``counts``（error/warn 条数）/``by_code``/``by_stage``/``files``/``elapsed_s`` 等。

    注意：**只负责合并**，不做与真实BOM 的一致性比对。
    """
    kwargs = _pipeline_kwargs(sub_bom_zip_path, total_bom_path, schema_path, mapping_path,
                              total_bom_sheet, root, order_units, emit=True)
    job_id = make_job_id()
    # 产出名里的 root 用**与管线同一处**的推断函数算出来，所以文件名与表里的根组件必然一致
    filename = artifact_filename(job_id, root_from_total_bom_url(total_bom_path, root))
    public, xlsx = await anyio.to_thread.run_sync(
        functools.partial(_run, "merge", kwargs, filename=filename, max_issues=max_issues))
    if not xlsx:                                            # 合并被阻断 / 内部错误：没有文件
        return result_json(public)
    try:
        bom_store.save(filename, xlsx)
    except OSError as e:
        # 落盘失败（磁盘满/权限/目录被挂成只读）：**不假装有产出**——artifact 清空、
        # 不写 viewUrl，并把原因写进 message，同时落一条 stderr 供运维定位
        print(f"产出落盘失败（{e.__class__.__name__}: {e}），本次无下载链接", file=sys.stderr)
        public["artifact"] = None
        public["message"] = f"{public['message']}（产出落盘失败，本次未交付 xlsx：{e.__class__.__name__}）"
        return result_json(public)
    base = _base_url(ctx)
    if not base:
        # 铸不出可点地址（没拿到请求且未配 BOM_PUBLIC_BASE_URL）：文件在，但不给假链接
        public["message"] = (f"{public['message']}"
                             "（已落盘但无法确定对外地址，未给出下载链接；"
                             "请配置 BOM_PUBLIC_BASE_URL）")
        return result_json(public)
    public["viewUrl"] = bom_store.public_url(base, filename)
    public["viewUrlName"] = filename
    return result_json(public)


def main() -> None:
    """启动：备好产出目录 → 清一次历史产出 → 以 streamable-http 跑起来。"""
    bom_store.ensure_dir()
    removed = bom_store.sweep()
    # 日志走 stderr：stdout 留给运行时（uvicorn 自身也往 stderr 打），运维重定向单一流即可
    print(f"BOM MCP 服务启动：streamable-http http://0.0.0.0:{_PORT}；"
          f"产出目录 {bom_store.directory()}"
          f"（保留 {bom_store.TTL_S:g}s / 上限 {bom_store.MAX_FILES} 个、"
          f"{bom_store.MAX_BYTES // 1024 // 1024}MB；启动清理 {removed} 个）",
          file=sys.stderr, flush=True)
    mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()
