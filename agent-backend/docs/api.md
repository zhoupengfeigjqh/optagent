# 数字人 Agent 后端 API 文档

> 手写维护（章程 VII），与 `specs/002-agent-chat-ui/contracts/`（http-api.md /
> sse-events.md）保持同步；契约变更须同步更新本文件。
> （`specs/001-digital-human-agent/contracts/` 已被 002 取代，仅作历史记录。）
>
> - Base URL：`http://<host>:<PORT>`（默认 3000），全部路径 `/api/*`
> - 本期无认证，所有请求归属内置用户 `admin`
> - 请求/响应均为 JSON（文件上传为 multipart）；SSE 仅发消息端点

## 统一错误格式

```json
{ "error": { "code": "POOL_EXHAUSTED", "message": "系统繁忙，请稍后重试" } }
```

状态码语义：`400` 参数非法 / `403` 权限 / `404` 不存在 / `409` 容量或状态冲突 /
`413` 文件超限 / `500` 内部错误。错误码一览见文末。

---

## 1. 数字人（agents，配置只读）

### `GET /api/agents` — 列表

`200 [{ "agent_name", "description" }]`
description 取 SOUL.md 首个非空行；**配置损坏的数字人不出现**（服务端日志有告警）。

### `GET /api/agents/{agent_name}` — 详情

```json
{
  "agent_name": "demo",
  "soul": "……SOUL.md 全文……",
  "skills": [{ "name": "report", "description": "生成报表" }],
  "enabled_tools": ["read_file", "calculator"],
  "mcp_servers": [{ "name": "erp", "transport": "http" }]
}
```

`mcp_servers` 仅含 `name/transport`，不含 url/command 等连接细节。
不存在或配置损坏 → `404 AGENT_NOT_FOUND`。

### `POST /api/agents/{agent_name}/select` — 选定数字人（覆盖式）

进入对话前必须 select。**覆盖式**选中：可随时切换，**无需先 exit**（原
`409 AGENT_SWITCH_REQUIRED` 已移除）；重复 select 同一数字人幂等
`200 { "agent_name", "selected": true }`。不销毁实例、不影响进行中的回复；
切换后的新数字人在**下一轮消息**生效（会话不绑定数字人，可在同一会话内切换）。

### `POST /api/agents/current/exit` — 退出当前数字人

仅清除选中状态；**实例不销毁**（LRU + 空闲超时自然回收），进行中的回复不受影响。
`200 { "exited": true|false }`（无选中时幂等 false）。

### `GET /api/agents/current` — 当前数字人

`200 { "agent_name": "demo" | null }`（未选中为 null）。

### `GET /api/agents/current/mcp` — 当前数字人 MCP 服务状态

`200 { "agent_name": "demo" | null, "mcp_servers": [{ "name", "transport", "status" }] }`。
`status ∈ connected | failed`；未选中时 `mcp_servers` 为空数组；实例尚未创建
（从未发消息）时全部 `failed`。仅暴露 `name/transport/status`，不含 url/command。

---

## 2. 模型（models）

### `GET /api/models` — 可用模型列表

`200 { "models": [{ "model": "deepseek-chat", "is_default": true }] }`。
`is_default` 恰一项；不暴露 api_key/base_url。

---

## 3. 对话管理（threads）

### `POST /api/threads` — 创建

- Request：`{ "agent_name": "demo" }`
- 前置：已 select 该数字人，否则 `409 AGENT_NOT_SELECTED`。**不限制会话总数**；
  并发上限（同一用户活跃对话 ≥3，跨数字人累计 → `409 THREAD_BUSY_LIMIT`）只在发消息接口判定
- Response：`201 { "thread_id": "uuid", "title": null, "created_at": "..." }`

### `GET /api/threads?agent_name=` — 列表

`200 [{ "thread_id", "agent_name", "title", "created_at", "updated_at" }]`
按 updated_at 倒序；title 默认取首条 user 消息前 20 字。

### `GET /api/threads/{thread_id}?limit=50&offset=0` — 详情（分页）

- `limit` 默认 50、最大 200；`offset` 从最新往前数
- `200 { "thread_id", "agent_name", "title", "created_at", "total", "messages": [...], "running": boolean }`
- `messages` 按时间正序；`total` 为全量条数；`running` 提示本轮是否仍在进行
  （SSE 断连后前端据此轮询刷新）
- 消息字段：

```json
{
  "id": "m_lxyz_4f2a", "role": "assistant", "content": "...",
  "ts": "2026-09-10T08:00:01.000Z",
  "status": "completed | failed",
  "usage": { "input_tokens": 10, "output_tokens": 5 },
  "duration_seconds": 2.345,
  "attachments": [{ "dir": "生产计划", "filename": "a.csv" }],
  "feedback": "up | down | null",
  "error": { "code": "LLM_ERROR", "message": "..." }
}
```

仅 assistant 完成轮有 `status/usage/duration_seconds`；失败轮 `status=failed` 且有
`error`；有 @ 引用的 user 消息带 `attachments`；`feedback` 恒存在（默认 null）。
**历史消息不含思考内容与工具调用信息**（FR-009）。
旧格式历史行（仅 role/content）兼容读取：`id` 合成为 `{thread_id}-{行号}`、
`ts` 回填会话创建时间。

### `PATCH /api/threads/{thread_id}` — 重命名

Request `{ "title": string }`（≤100 字）→ `200 { "thread_id", "title" }`

### `DELETE /api/threads/{thread_id}` — 删除

连带删除 history/summary 及 tmp/ 下该 thread_id 前缀全部文件；进行中的回复先中断。
`204` 无响应体。

### `PUT /api/threads/{thread_id}/messages/{message_id}/feedback` — 消息反馈（点赞/点踩）

- Request：`{ "value": "up" | "down" | null }`
- 语义：点赞/点踩互斥（新值覆盖旧值）；**重复提交同值 = 取消**（转为 null）；
  显式传 null 清除反馈
- Response：`200 { "message_id", "feedback": "up" | "down" | null }`
- 消息不存在 → `404 MESSAGE_NOT_FOUND`；会话不存在 → `404 THREAD_NOT_FOUND`

---

## 4. 对话（SSE 流式）

### `POST /api/threads/{thread_id}/messages` — 发送消息

- Request：`{ "content": string, "thinking"?: boolean, "model"?: string, "attachments"?: [{ "dir", "filename" }] }`
  - `model`：请求级模型覆盖（须为配置内模型），非法 → `400 MODEL_NOT_FOUND`
  - `attachments`：@ 文件引用（≤10）；目录限 7 业务目录 + shared + tmp，
    引用文件不存在 → `400 FILE_REF_NOT_FOUND`；引用目录非白名单 → `403`
  - 提交 LLM 时 user 内容末尾追加 `[引用文件] dir/filename；...` 标注；
    历史落盘保留结构化 `attachments`，content 本体不含引用文本
- Response：`200 text/event-stream`（事件见下）
- 冲突：该对话已有进行中的回复 → `409 THREAD_RUN_ACTIVE`；实例池满 →
  `409 POOL_EXHAUSTED`；并发对话超限 → `409 THREAD_BUSY_LIMIT`

**断连语义**：SSE 断开后本轮继续跑完并完整落盘；重连不实时续推，用
`GET /api/threads/{id}` 拉完整历史（`running` 字段提示进行中）。

### `POST /api/threads/{thread_id}/stop` — 中断当前轮

丢弃本轮未保存消息；**已消耗 Token 仍计用量**；实例不销毁。
`200 { "stopped": true|false }`（无进行中 run 时幂等 false）。

### SSE 事件（6 类）

```
event: thinking      data: {"delta": "..."}                            # 仅 thinking:true 时；不落盘
event: content       data: {"delta": "..."}                            # 正式回复流，结束后整体落盘
event: tool_call     data: {"call_id": "...", "name": "...", "status": "running"}   # 工具开始
event: tool_call_end data: {"call_id": "...", "status": "success|error"}            # 工具结束
event: done          data: {"finish_reason": "stop|completed", "usage": {...}, "duration_seconds": 2.345, "message_id": "m_...|null", "agent_name": "..."}
event: error         data: {"error": {"code": "...", "message": "..."}, "duration_seconds"?: 2.345, "usage"?: {...}, "agent_name": "..."}
```

工具事件**只含工具名与状态**；入参、过程输出、结果永不透出（不落盘也不广播）。
`done.message_id` 为 assistant 落盘消息 ID；`stop`（本轮丢弃）时为 null。
`agent_name` 为本轮回答的数字人（**会话不绑定数字人**，同一会话内可切换，逐条消息记录）。
时序不变式：`thinking*` → `content*`（可穿插 `tool_call`/`tool_call_end` 成对出现）→
恰好一个终结事件（`done` 或 `error`）。
可恢复错误（如 MCP 不可用）由数字人在 content 中自然语言说明，**不走 error 事件**。

---

## 5. 文件（files）

### `POST /api/files/upload` — 上传（multipart）

- 字段：`file`（文件）、`dir`（7 个业务目录之一、`shared` 或 `tmp`）
- 限制：≤50MB（`413`）；扩展名 ∈ `.csv .xlsx .txt .json .pdf`（`400`）
- 落盘名自动追加 `_YYYYMMDD_HHMMSS` 时间戳
- Response：`201 { "dir", "filename", "size" }`

### `GET /api/files/list?dir=` — 列表

`200 [{ "filename", "size", "updated_at" }]`（`dir` 含 `tmp`，查看数字人产出）

### `GET /api/files/download?dir=&filename=` — 下载

`200` 文件流；路径穿越一律 `400`。

### `GET /api/files/preview?dir=&filename=` — 内联预览

`200`，`Content-Disposition: inline`；Content-Type 按扩展名映射
（`.txt/.csv/.json/.pdf`）；`.xlsx` 回退附件下载；超过预览上限
（默认 10MB，`PREVIEW_MAX_MB` 可配）→ `413`；不存在 → `404 FILE_NOT_FOUND`。

### `GET /api/files/workspace` — 工作空间汇总

`200 { "dirs": [{ "dir", "files": [{ "filename", "size", "updated_at" }] }] }`。
覆盖全部 9 个白名单目录（7 业务 + shared + tmp）；空目录 `files: []`。

---

## 6. 监控（monitor，内网只读）

### `GET /api/monitor/agents` — 实例池明细

```json
{
  "alive": 1, "max": 5,
  "instances": [{ "user_id": "admin", "agent_name": "demo",
                  "active_threads": 0, "idle_seconds": 42, "unavailable_mcp": ["erp"] }]
}
```

### `GET /api/monitor/health` — 健康探针

`200 { "status": "ok", "uptime_seconds": 123, "memory_rss_bytes": ..., "disk_free_bytes": ... }`
（disk_free_bytes 为 `.opt-agent/` 所在卷可用字节数）

---

## 7. Token 用量（usage）

### `GET /api/usage/summary?thread_id=&agent_name=&from=&to=`

- `from/to` 为 ISO8601（含边界）
- Response：

```json
{
  "total_input_tokens": 115, "total_output_tokens": 28, "records": 3,
  "grouped": [{ "thread_id": "t1", "agent_name": "demo",
                "input_tokens": 15, "output_tokens": 27, "records": 2 }]
}
```

每轮对话恰产生一条记录（stop 中断轮也计）。

---

## 错误码一览

| code | HTTP | 场景 |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | 参数/格式非法（含路径穿越、扩展名不符、反馈 value 非法、引用超 10 个） |
| `FILE_TOO_LARGE` | 413 | 上传 >50MB；预览 >预览上限 |
| `UPLOAD_DIR_FORBIDDEN` | 403 | 上传/引用未开放目录 |
| `FILE_NOT_FOUND` | 404 | 下载/预览的文件不存在 |
| `FILE_REF_NOT_FOUND` | 400 | @ 引用的文件不存在 |
| `MODEL_NOT_FOUND` | 400 | 请求级 model 不在配置内 |
| `MESSAGE_NOT_FOUND` | 404 | 反馈的目标消息不存在 |
| `THREAD_NOT_FOUND` / `AGENT_NOT_FOUND` | 404 | 对话/数字人不存在（或配置损坏） |
| `THREAD_RUN_ACTIVE` | 409 | 该对话已有进行中的回复 |
| `THREAD_BUSY_LIMIT` | 409 | 同一用户并发对话超 3（跨数字人累计） |
| `AGENT_NOT_SELECTED` | 409 | 创建对话/发消息前未 select |
| `POOL_EXHAUSTED` | 409 | 实例池满且无空闲可淘汰 |
| `TMP_WRITE_FAILED` | 500 | tmp 写入失败 |
| `INTERNAL_ERROR` | 500 | 兜底 |
