# Contracts: SSE 事件流

> **⚠️ 已被取代（Superseded）**：002 特性扩展了 SSE 协议（新增 `tool_call` /
> `tool_call_end` 事件，`done` 增加 `duration_seconds` + `message_id`，`error`
> 增加可选 `duration_seconds` + `usage`）。当前有效契约见
> [../../002-agent-chat-ui/contracts/sse-events.md](../../002-agent-chat-ui/contracts/sse-events.md)。
> 本文件仅保留为 001 历史记录。
>
> 唯一 SSE 端点：`POST /api/threads/{thread_id}/messages`（发新消息并启动 run）。
>
> SSE 是 Run Manager 事件总线的**订阅者**：客户端断开只是退订，run 继续跑完
> 并落盘；**本期不做实时续推**——重连后前端用 `GET /api/threads/{id}` 拉完整
> 历史（续推所需的事件广播骨架已就位，二期加一个订阅者即可恢复该能力）。

## 事件类型（4 类）

### `thinking` — 推理流（不落盘）

```
event: thinking
data: {"delta": "..."}
```

仅当本轮请求 `thinking: true` 时产生；前端折叠渲染；**不写入 history.jsonl**。

### `content` — 正式回复流

```
event: content
data: {"delta": "..."}
```

落盘器独立订阅此流并累积，run 结束后整体写入 history.jsonl。

### `done` — 本轮结束

```
event: done
data: {"finish_reason": "stop|completed", "usage": {"input_tokens": 0, "output_tokens": 0}}
```

### `error` — 错误

```
event: error
data: {"error": {"code": "...", "message": "..."}}
```

与 HTTP 错误 envelope 同构。可恢复错误（如 MCP 不可用）由 Agent 在 content 中
以自然语言提示（"当前服务不可用，请稍后尝试"），**不走 error 事件**；
error 事件仅用于本轮无法继续的致命错误。

### ~~`resumed`~~（二期候选，本期不实现）

实时续推标记，随"重连续播"能力二期一并引入；本期重连走 `GET /api/threads/{id}` 拉历史。

## 明确不输出的内容（FR-020）

- tool 调用日志、工具参数与结果详情
- 中间推理链（thinking 事件除外）
- MCP 请求/响应日志（进服务端日志，不进 SSE）

## 时序不变式

1. 事件顺序：`thinking*` → `content*` → `done | error` 终结，每轮恰好一个终结事件。
2. 断连后客户端不再收到事件，但落盘器订阅持续；`done` 后历史文件必含完整
   assistant 消息（SC-005）。
3. `stop` 后：SSE 收到 `done {"finish_reason":"stop"}`（已推送内容保留在前端，
   未保存部分丢弃，history 不含本轮）。
