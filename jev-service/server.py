"""Jev MCP 服务：TypeSafe System One（state + 类型化问题 → 结构化决策）+ FastMCP streamable-http。

对 Agent 暴露三个**原子工具**，与 Jev 的 primitive 一一对应：``noul`` / ``choice`` / ``score``。
运行时由 agent-backend 加上 server 前缀呈现为 ``jev__noul`` / ``jev__choice`` / ``jev__score``。

state 双通道（**合并**，不是二选一）：
- ``state``：LLM 生成的文本（判断意图与背景）；
- ``state_file``：文件空间**相对路径**（如 `临时空间/订单.csv`），由 agent-backend 经
  ``file_args`` 声明铸成签名直链发来，本服务按 URL 回源下载后与文本合并。

最终送给 Jev 的 state 形如::

    <LLM 文本>

    【引用文件：临时空间/订单.csv】
    <文件内容>

为何是两个参数而非一个：agent-backend 的 ``file_args`` 改写对声明的参数是**无条件**的——
非 http(s) 的字符串一律送沙箱路径校验（``mcp-tool-adapter.ts`` 的 ``convertLeaf``），
若把 ``state`` 本身声明为文件参数，纯文本调用会被判"目录不在白名单"而失败。

无共享存储依赖：可本地容器运行，也可远程部署。
分工：入参校验 / 请求构造 / 重试 / 错误映射在 ``jev_core``（不依赖 MCP 框架，可单测）；
本文件只做 MCP 工具装配、日志与结果/错误的文本化。
"""
import json
import os
import sys
from typing import Annotated, Any

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

from jev_core import (
    ALLOW_HOSTS,
    BASE_URL,
    MODEL,
    JevError,
    build_body,
    choice_question,
    format_answer,
    noul_question,
    post_with_retry,
    resolve_state,
    score_question,
    usage_of,
)

API_KEY = os.environ.get("TYPESAFE_API_KEY", "").strip()

mcp = FastMCP("jev", host="0.0.0.0", port=8000)


class ChoiceOption(BaseModel):
    """choice 的一个候选选项"""

    value: str = Field(description="选项取值，Jev 会原样回传（如 billing）")
    criteria: str = Field(default="", description="该选项的判定标准；无需额外说明可留空")


STATE_DESC = (
    "LLM 生成的待判断文本（如用户诉求概述、待核对的记录）。"
    "与 state_file 会**合并**为最终 state：文本在前、引用文件内容在后，可同时提供。"
)
STATE_FILE_DESC = (
    "待判断内容所在的文件：填用户消息 [引用文件] 中的相对路径（如 临时空间/订单.csv），"
    "backend 会自动铸成下载直链。内容会追加在 state 文本之后。与 state 至少提供其一。"
)
INSTRUCTIONS_DESC = "要判断什么（原子化：只问一件事，如「该客户明确表达了不满」）"


def _log(event: str, **fields: Any) -> None:
    """结构化日志：单行 JSON 落 stderr（容器由 compose 的 json-file 轮转 10MB×3 兜底）。"""
    print(json.dumps({"event": event, **fields}, ensure_ascii=False, default=str), file=sys.stderr, flush=True)


def _run(kind: str, question: dict[str, Any], state: str, state_file: str) -> str:
    """统一执行入口：解析 state → 调用 Jev → 格式化；任何失败都转成**可读文本**返回。

    降级对用户可感知（宪章原则九）：错误以自然语言作为工具结果返回，
    Agent 与用户都能读到"发生了什么、该怎么办"，而不是一个堆栈。
    原始错误（状态码 + 上游返回体）落结构化日志，不丢失。
    """
    try:
        resolved = resolve_state(state, state_file)
        payload = post_with_retry(build_body(resolved, question), api_key=API_KEY)
        _log(
            "jev.call.ok",
            kind=kind,
            model=payload.get("model"),
            usage=usage_of(payload),
            state_chars=len(resolved),
            state_file=bool((state_file or "").strip()),
        )
        return format_answer(kind, payload)
    except JevError as e:
        _log(
            "jev.call.failed",
            kind=kind,
            status=e.status,
            reason=str(e),
            detail=(e.body or "")[:500] or None,
        )
        return str(e)
    except Exception as e:  # 兜底：未预期异常也必须被用户看见，且原文落日志
        _log("jev.call.failed", kind=kind, status=None, reason=f"{type(e).__name__}: {e}", alert=True)
        return f"错误：Jev 调用失败（{type(e).__name__}），请稍后重试"


@mcp.tool()
def noul(
    instructions: Annotated[str, Field(description=INSTRUCTIONS_DESC)],
    state: Annotated[str, Field(description=STATE_DESC)] = "",
    state_file: Annotated[str, Field(description=STATE_FILE_DESC)] = "",
    true_meaning: Annotated[str, Field(description="（可选）命题为真代表什么，用于校准判断口径")] = "",
    false_meaning: Annotated[str, Field(description="（可选）命题为假代表什么")] = "",
) -> str:
    """判断一个命题是否成立，返回真值概率（0=假，1=真）。

    适合"是/否"型原子判断：是否紧急、是否重复工单、是否满足某条件。
    返回紧凑 JSON：{"type":"noul","noul":0.95}
    """
    return _run("noul", noul_question(instructions, true_meaning, false_meaning), state, state_file)


@mcp.tool()
def choice(
    instructions: Annotated[str, Field(description=INSTRUCTIONS_DESC)],
    options: Annotated[list[ChoiceOption], Field(description="候选选项，2–255 个，互斥且覆盖全部可能")],
    state: Annotated[str, Field(description=STATE_DESC)] = "",
    state_file: Annotated[str, Field(description=STATE_FILE_DESC)] = "",
) -> str:
    """从给定选项里选一个，返回选中项、各选项概率分布与置信度。

    适合路由/分类类决策（该工单归哪个团队、属于哪类意图）。
    返回紧凑 JSON：{"type":"choice","choice":"billing","confidence":0.81,"probabilities":{...}}
    """
    return _run(
        "choice",
        choice_question(
            instructions,
            [{"value": option.value, "criteria": option.criteria} for option in options],
        ),
        state,
        state_file,
    )


@mcp.tool()
def score(
    instructions: Annotated[str, Field(description=INSTRUCTIONS_DESC)],
    levels: Annotated[list[str], Field(description="有序等级描述，从低到高（2–10 个），如 平静/不满/非常愤怒")],
    state: Annotated[str, Field(description=STATE_DESC)] = "",
    state_file: Annotated[str, Field(description=STATE_FILE_DESC)] = "",
) -> str:
    """按给定量表打分，返回概率加权分值（可能落在两级之间）、等级表与置信度。

    适合强度/程度类判断（紧急程度、客户不满程度）。
    返回紧凑 JSON：{"type":"score","score":1.05,"confidence":0.92,"legend":{...},"probabilities":{...}}
    """
    return _run("score", score_question(instructions, levels), state, state_file)


if __name__ == "__main__":
    if not API_KEY:
        print(
            "警告：未配置 TYPESAFE_API_KEY，所有工具调用将返回可读错误（见 jev-service/.env.local）",
            file=sys.stderr,
            flush=True,
        )
    _log(
        "jev.service.started",
        model=MODEL,
        base_url=BASE_URL,
        api_key_configured=bool(API_KEY),
        allow_hosts=sorted(ALLOW_HOSTS),
    )
    mcp.run(transport="streamable-http")
