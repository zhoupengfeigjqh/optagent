# 契约：SSE 事件流（变更/新增）

**Feature**: 002-agent-chat-ui | **Endpoint**: `POST /api/threads/:id/messages`（`text/event-stream`）

向后兼容：新增事件类型与字段，旧客户端可忽略未知 event。

## 事件清单

### thinking（不变）

```
event: thinking
data: {"delta": "..."}
```

实时增量；**不落历史**。

### content（不变）

```
event: content
data: {"delta": "..."}
```

### tool_call（新增）

工具调用开始。仅含工具名与调用标识，**永不包含入参**。

```
event: tool_call
data: {"call_id": "call_abc123", "name": "read_file", "status": "running"}
```

### tool_call_end（新增）

工具调用结束。**永不包含返回内容**；`status` 仅标识成功/失败。

```
event: tool_call_end
data: {"call_id": "call_abc123", "status": "success"}
```

配对规则：同一 `call_id` 的 `tool_call` 与 `tool_call_end` 成对出现，顺序与时间序一致；一轮可有多次调用（含并行，call_id 区分）。

### done（变更：+duration_seconds、+message_id、+agent_name）

```
event: done
data: {
  "finish_reason": "completed|stop",
  "usage": {"input_tokens": 123, "output_tokens": 456},
  "duration_seconds": 4.2,
  "message_id": "m_lxyz12_ab3f",
  "agent_name": "ops"
}
```

`duration_seconds` 为整轮（含工具循环全部 LLM 往返）耗时，1 位小数。`message_id` 为 assistant 落盘消息 ID，供反馈接口使用；`finish_reason=stop`（中断）时不落消息行，`message_id` 为 null。
**2026-09-10 修订**：`agent_name` 为本轮回答的数字人——会话不绑定数字人，同一会话内可切换，逐条消息记录（user/assistant 成对）。

### error（变更：+duration_seconds、+usage 可选、+agent_name）

```
event: error
data: {"error": {"code": "LLM_ERROR", "message": "..."}, "duration_seconds": 4.2, "usage": {"input_tokens": 123, "output_tokens": 45}, "agent_name": "ops"}
```

`duration_seconds` 与 `usage` 均为可选：本轮已消耗可统计时提供（FR-005），不可统计时省略。

## 事件顺序示例（含一次工具调用 + 思考）

```
thinking → thinking → tool_call → tool_call_end → content* → done
```

## 请求体（变更）

```json
{
  "content": "分析这份计划",
  "thinking": true,
  "model": "deepseek-chat",
  "attachments": [{ "dir": "生产计划", "filename": "a_20260910_080000.csv" }]
}
```

| 字段 | 必选 | 说明 |
|---|---|---|
| content | 是 | ≥1 字符 |
| thinking | 否 | 默认 false（快速模式） |
| model | 否 | 须命中 GET /api/models 列表，否则 400 `MODEL_NOT_FOUND`；缺省用默认模型 |
| attachments | 否 | ≤10 个；dir 白名单校验、文件须存在，否则 400 `FILE_REF_NOT_FOUND` |

提交给 LLM 时 content 自动追加引用段（见 research.md D7）。

409 链：AGENT_NOT_SELECTED → THREAD_BUSY_LIMIT → POOL_EXHAUSTED → THREAD_RUN_ACTIVE。
（**2026-09-10 修订**：移除 `AGENT_SWITCH_REQUIRED`——`select` 为覆盖式，切换无需先 exit；
会话不绑定数字人，本轮由**当前选中数字人**执行。）
