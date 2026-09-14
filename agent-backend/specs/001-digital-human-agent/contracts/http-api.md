# Contracts: REST HTTP API

> **⚠️ 已被取代（Superseded）**：002 特性扩展了 HTTP API（消息接口增加
> `model`/`attachments` 字段，新增反馈、模型列表、当前数字人、文件预览、
> 工作空间汇总等端点）。当前有效契约见
> [../../002-agent-chat-ui/contracts/http-api.md](../../002-agent-chat-ui/contracts/http-api.md)。
> 本文件仅保留为 001 历史记录。
>
> 统一约定：全部 `/api/*`；本期无认证，所有请求归属内置 `admin`；
> 请求/响应均为 JSON（上传除外）；统一错误 envelope：
>
> ```json
> { "error": { "code": "POOL_EXHAUSTED", "message": "系统繁忙，请稍后重试" } }
> ```
>
> 状态码语义：400 参数非法 / 403 权限 / 404 不存在 / 409 容量或状态冲突 / 413 文件超限 / 500 内部错误。

## 1. 对话（SSE 详见 [sse-events.md](./sse-events.md)）

### `POST /api/threads/{thread_id}/messages` — 发送消息（SSE 响应）

- **Request**: `{ "content": string, "thinking"?: boolean }`
- **行为**：该 thread 无进行中 run → 启动新 run；**有进行中 run → 409
  `THREAD_RUN_ACTIVE`**（等本轮结束再发）；池满 → 409 `POOL_EXHAUSTED`；
  该用户活跃 thread 数超 3（**跨数字人累计**）→ 409 `THREAD_BUSY_LIMIT`。
- **Response**: `200`，`Content-Type: text/event-stream`，事件见 SSE 契约。

> **断连与重连**：SSE 断开后 run 继续跑完并落盘（FR-026）；重连不实时续推，
> 前端用 `GET /api/threads/{id}` 拉取完整历史（running 字段可提示仍在进行，
> 前端可轮询刷新）。实时续推（resumed 续播）为二期候选，架构已预留
> （事件总线广播，加一个订阅者即可）。

### `POST /api/threads/{thread_id}/stop` — 中断当前轮

- **行为**：中断该 thread 的流与推理，丢弃本轮未保存消息；**本轮已消耗的
  Token 仍记录用量**；不销毁 Agent 实例。
- **Response**: `200 { "stopped": true }`；该 thread 无进行中 run 时
  `200 { "stopped": false }`（幂等）。

## 2. 对话管理（threads）

### `POST /api/threads` — 创建对话

- **Request**: `{ "agent_name": string }`
- **前置**：须已 `select` 该数字人（见 §4）。**不限制会话总数**，可连续创建任意多个 thread；
  并发限制（同一用户活跃 thread 数 ≥3，跨数字人累计 → 409 `THREAD_BUSY_LIMIT`）**只在发消息接口执行**。
- **Response**: `201 { "thread_id": "uuid", "title": null, "created_at": "..." }`

### `GET /api/threads` — 对话列表

- **Query**: `agent_name?`（按数字人过滤）
- **Response**: `200 [{ "thread_id", "agent_name", "title", "created_at", "updated_at" }]`
  按 updated_at 倒序；title 默认取首条 user 消息前 20 字。

### `GET /api/threads/{thread_id}` — 对话详情（含历史，分页）

- **Query**: `limit?`（默认 50，最大 200）、`offset?`（从最新往前数）
- **Response**: `200 { "thread_id", "agent_name", "title", "total": number,
"messages": [{ "role", "content" }], "running": boolean }`
  （messages 为最近 limit 条，按时间正序；`total` 为全量条数供前端分页）

### `PATCH /api/threads/{thread_id}` — 重命名

- **Request**: `{ "title": string }`（≤100 字）
- **Response**: `200 { "thread_id", "title" }`

### `DELETE /api/threads/{thread_id}` — 删除

- **行为**：连带删除 history/summary 及 `临时空间/` 下该 thread_id 前缀全部文件；
  有进行中 run 先 abort。
- **Response**: `204`

## 3. 文件（files）

### `POST /api/files/upload` — 上传（multipart）

- **Form 字段**: `file`（文件）、`dir`（目标目录，**2026-09-13 修订**为三空间相对路径：
  `数据准备/{业务子目录}`、`共享空间`、`临时空间`）
- **校验**：`dir` 非法（绝对路径 / `..` / 反斜杠）→ 400 `VALIDATION_FAILED`；
  未知空间或未知数据准备子目录 → 403 `UPLOAD_DIR_FORBIDDEN`；
  数据准备不带子目录 → 400；共享空间/临时空间带子目录 → 400；≤50MB（413）；
  扩展名按目标空间策略校验（数据准备仅 `.csv`/`.xlsx`，另两个空间见 data-model §6）→ 400，
  消息 MUST 指明该空间支持的格式；落盘名自动追加 `_YYYYMMDD_HHMMSS`。
- **Response**: `201 { "dir", "filename", "size" }`（`dir` 为规范化后的相对路径；filename 为追加时间戳后的实际名）

### `GET /api/files/list` — 文件列表

- **Query**: `dir`（三空间相对路径，含 `临时空间`——用户可查看 Agent 产出）
- **Response**: `200 [{ "filename", "size", "updated_at" }]`

### `GET /api/files/download` — 下载/查看

- **Query**: `dir`, `filename`
- **Response**: `200` 文件流；路径穿越（`..` 等）一律 400。

## 4. 数字人（agents，配置只读）

### `GET /api/agents` — 数字人列表

- **Response**: `200 [{ "agent_name", "description" }]`
  （description 取 SOUL.md 首行或 frontmatter 摘要；配置损坏的数字人不出现）

### `GET /api/agents/{agent_name}` — 数字人详情

- **Response**: `200 { "agent_name", "soul", "skills": [{ "name", "description" }],
"enabled_tools": [...], "mcp_servers": [{ "name", "transport" }] }`
  （不含密钥类字段）

### `POST /api/agents/{agent_name}/select` — 选定数字人进入对话（覆盖式）

- **行为**：记录"当前用户选中该数字人"。**覆盖式**：当前已选中**另一个**数字人时
  **直接覆盖**，**无需先 exit**（原 409 `AGENT_SWITCH_REQUIRED` 已移除，
  **2026-09-10 修订**）；重复 select 同一数字人幂等 200；不销毁实例、不影响进行中的 run。
- **Response**: `200 { "agent_name", "selected": true }`

### `POST /api/agents/current/exit` — 退出当前数字人

- **行为**：仅清除"当前选中"状态；**后端 Agent 实例不销毁**（LRU + 空闲超时
  自然回收）；进行中的 run 不受影响。
- **Response**: `200 { "exited": true }`（无选中时幂等 `200 { "exited": false }`）

> 状态存储：本期进程内 Map（user_id → agent_name）；纳入 PoolStore 同级的
> "会话状态"抽象，日后随分布式方案一起替换。

## 5. 监控（monitor，内网只读）

### `GET /api/monitor/agents`

- **Response**: `200 { "alive": number, "max": 5, "instances": [{ "user_id",
"agent_name", "active_threads": number, "idle_seconds": number,
"unavailable_mcp": [string] }] }`

### `GET /api/monitor/health`

- **Response**: `200 { "status": "ok", "uptime_seconds": number,
"memory_rss_bytes": number, "disk_free_bytes": number }`

## 6. Token 用量（usage）

### `GET /api/usage/summary`

- **Query**: `thread_id?`, `agent_name?`, `from?`（ISO8601）, `to?`
- **Response**: `200 { "total_input_tokens": number, "total_output_tokens": number,
"records": number, "grouped": [{ "thread_id"?, "agent_name"?,
"input_tokens", "output_tokens" }] }`

---

## 错误码一览（code 字段）

| code                                   | HTTP | 场景                                           |
| -------------------------------------- | ---- | ---------------------------------------------- |
| `VALIDATION_FAILED`                    | 400  | 参数/格式非法（含路径穿越、扩展名不符）        |
| `FILE_TOO_LARGE`                       | 413  | 上传 >50MB                                     |
| `UPLOAD_DIR_FORBIDDEN`                 | 403  | 试图上传到 tmp 或未开放目录                    |
| `THREAD_NOT_FOUND` / `AGENT_NOT_FOUND` | 404  |                                                |
| `THREAD_RUN_ACTIVE`                    | 409  | 该 thread 已有进行中 run（新消息须等本轮结束） |
| `THREAD_BUSY_LIMIT`                    | 409  | 同一用户并发 thread 超 3（跨数字人累计）       |
| `AGENT_NOT_SELECTED`                   | 409  | 创建对话/发消息前未 select 数字人              |
| `POOL_EXHAUSTED`                       | 409  | 实例池满且无空闲可淘汰                         |
| `TMP_WRITE_FAILED`                     | 500  | tmp 写入失败（"临时空间不足，请稍后重试"）     |
| `INTERNAL_ERROR`                       | 500  | 兜底                                           |
