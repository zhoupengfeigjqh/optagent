# -*- coding: utf-8 -*-
"""MCP 工具"注册面"单测（不需要真实数据、不起服务）。

守住两个只在装配期才会炸的坑：
1. `@mcp.tool()` 默认的结构化输出会把 `-> str` 交给 pydantic 建模，在本环境
   （mcp 1.26 + pydantic 2.10）下直接抛 PydanticUserError，工具注册失败 → 服务起不来。
2. 参数名若与 `BaseModel` 的既有属性重名（`schema_json`/`dict`/`json`/`copy`/`schema`…），
   FastMCP 会改名为 `field_<name>` 并加 alias，本环境下 alias 不生效 ⇒ 调用必失败。

另守两条本服务特有的契约：
3. **两个工具都不声明 `resultUrl`**（异步已整体移除）：留着它等于告诉平台"这个工具要异步"。
4. 工具内的 `ctx: Context` 只用于取请求 Host 铸造下载地址，**不得出现在入参 schema 里**
   —— 出现就意味着模型得自己编一个"上下文"参数。
"""
import asyncio
import importlib.util

import pytest

pytestmark = pytest.mark.skipif(importlib.util.find_spec("mcp") is None,
                               reason="未安装 mcp（仅运行期依赖），跳过工具注册面测试")

#: 四个文件参数的**对外名**（相对路径口径，平台铸造/注入后才会真正调用）——两个工具都必须声明，且必须必填
COMMON = {"sub_bom_zip_path", "total_bom_path", "schema_path", "mapping_path"}
#: 每个工具**额外**声明的可选参数（一律不得必填：缺省即按默认值跑，模型不必填）
EXTRA = {
    "bom_validate": {"total_bom_sheet", "root", "order_units", "max_issues"},
    "bom_merge": {"total_bom_sheet", "root", "order_units", "max_issues"},
}
#: 全同步方案下**不该**再出现的参数：注入即异步，留着会被平台误加、模型误填
RETIRED = {"resultUrl"}


def tools():
    import server
    return asyncio.run(server.mcp.list_tools())


def test_both_tools_are_registered():
    names = {t.name for t in tools()}
    assert names == {"bom_validate", "bom_merge"}


def test_declared_params_match_design():
    """四个文件参数必须声明且必填；其余参数按各工具设计声明，且一律不得必填。"""
    for t in tools():
        schema = t.inputSchema or {}
        props = set((schema.get("properties") or {}).keys())
        required = set(schema.get("required") or [])
        expect = COMMON | EXTRA[t.name]
        assert expect <= props, f"{t.name} 缺参数：{sorted(expect - props)}"
        assert COMMON <= required, f"{t.name} 的必填入参不完整"
        assert not (EXTRA[t.name] & required), (
            f"{t.name} 把 {sorted(EXTRA[t.name] & required)} 标成了必填："
            "这些都有缺省语义，标必填会让调用方多填一堆无用参数")


def test_no_tool_declares_result_url():
    """异步已整体移除：**两个工具都不得**声明 resultUrl（声明了就等于把自己标成异步）。"""
    for t in tools():
        props = set((t.inputSchema or {}).get("properties") or {})
        assert not (props & RETIRED), f"{t.name} 仍声明了 {sorted(props & RETIRED)}"


def test_context_param_is_not_exposed_to_model():
    """`ctx` 是 FastMCP 注入的上下文，绝不能出现在 schema 里（模型不该看到它）。"""
    for t in tools():
        props = set((t.inputSchema or {}).get("properties") or {})
        assert "ctx" not in props, f"{t.name} 把 ctx 暴露给了模型"


def test_param_names_avoid_pydantic_basemodel_attributes():
    """参数名不得与 BaseModel 的可调用属性重名（FastMCP 会加 `field_` 前缀导致调用失败）。"""
    from pydantic import BaseModel
    for t in tools():
        for name in (t.inputSchema or {}).get("properties") or {}:
            assert not (hasattr(BaseModel, name) and callable(getattr(BaseModel, name))), (
                f"{t.name}.{name} 与 pydantic BaseModel 属性重名，调用会因别名失效而失败")


def test_descriptions_present_and_mention_injection_contract():
    """说明必须讲清「由平台自动注入」，且**不得**再提 url/http。

    对外口径是相对路径：模型看到的应是"路径 + 平台注入"，而不是"自己拼一个直链"。
    """
    for t in tools():
        props = (t.inputSchema or {}).get("properties") or {}
        for name in COMMON:
            desc = props[name].get("description") or ""
            assert desc, f"{t.name}.{name} 缺 description（模型看不到用法）"
            assert "自动注入" in desc, f"{t.name}.{name} 的说明没讲清「由平台自动注入」"
            low = desc.lower()
            assert "url" not in low and "http" not in low, (
                f"{t.name}.{name} 的说明仍标注 url/http：对外一律是相对路径口径")
        # 工具说明要提到按 schema 输出；合并还要讲清产出怎么拿（下载地址来自本服务）
        assert t.description and "schema" in t.description
        if t.name == "bom_merge":
            assert "viewUrl" in t.description, "合并的说明没提下载地址（模型不知道结果在哪）"
