# 契约：前端 ↔ 后端接口

**Feature**: 001-agent-chat-ui | **Base**: `/api`（开发期由 Vite 代理转发）

**权威来源（按优先级）**:

1. **后端源码**（已逐文件核对，2026-09-10）：`agent-backend/src/routes/{agents,chat,threads,files,feedback,models}.ts`、`src/domain/{dirs,thread-store,run-manager,current-agent,file-access,agent-pool}.ts`、`src/{server,types,config}.ts`、`src/infra/agent-loop.ts`
2. 后端契约文档：`agent-backend/specs/002-agent-chat-ui/contracts/http-api.md`、`sse-events.md`
3. 后端接口文档：`agent-backend/docs/api.md`

**注意**：核对发现契约文档与源码存在 6 处不一致，已在 [§7 已知差异](#7-已知差异与契约缺口2026-09-10-源码核对) 逐条列出，并附**文档行号 / 源码行号**便于直接定位。
**本文件一律以源码为准**；如与后端文档冲突，前端按本文件实现，并推动后端修订文档。

- 本期无认证，所有请求归属后端内置用户 `admin`。
- 统一错误体：`{ "error": { "code": string, "message": string, "details"?: unknown } }`。
- 前端**不展示**后端 `message` 作为主文案，一律经 `src/utils/error-message.ts` 按 `code` 映射（D13）。
- 多数接口的 JSON Schema 设置了 `additionalProperties: false`：**传入未声明的查询参数会被拒绝**，
  前端不得凭猜测添加参数（详见 §7 差异 2）。
- 所有请求经 `src/api/http.ts` 封装；SSE 经 `src/api/sse.ts` 封装；类型定义于 `src/api/types.ts`。

---

## 1. 数字人与 MCP

### 1.1 `GET /api/agents` — 数字人列表

- 响应：**顶层数组** `[{ agent_name, description }]`（非包裹对象）
- 前端用途：数字人切换面板的候选列表；配置损坏的数字人已被后端排除并告警，前端无需过滤。

### 1.2 `GET /api/agents/{agent_name}` — 数字人详情

- 响应：`{ agent_name, soul, skills: [{name, description}], enabled_tools: string[], mcp_servers: [{name, transport}] }`
- 前端映射：`soul` 全文展示为"描述"；`mcp_servers` 仅展示名称与传输方式，**不含** url/command 等连接细节。
- 错误：`404 AGENT_NOT_FOUND` → 面板内提示"数字人不存在或配置异常"。

### 1.3 `POST /api/agents/{agent_name}/select` — 选定

- 响应：`200 { agent_name, selected: true }`（重复 select 同一数字人幂等）
- 错误：
  - `404 AGENT_NOT_FOUND` — 该数字人配置不存在或损坏
  - ~~`409 AGENT_SWITCH_REQUIRED`~~ — **已于 2026-09-10 移除**：`select` 为**覆盖式**，
    切换**无需先 exit**（已选中他人时直接覆盖）。
- **关键事实**：该接口**不校验会话是否进行中**。
  因此"会话进行中禁止切换"（FR-036）是**纯前端 UX 约束**：前端置灰入口、不发请求。
  后端不提供兜底拦截（见 §7 差异 3）。

### 1.4 `POST /api/agents/current/exit` — 退出当前数字人

- 响应：`200 { exited: boolean }`（`exited` 表示退出前是否处于选中态；未选中时幂等返回 `false`）
- 语义：仅清除选中状态，**实例不销毁**（LRU + 空闲超时自然回收），进行中的回复不受影响。

### 1.5 `GET /api/agents/current` — 当前数字人

- 响应：`200 { agent_name: string | null }`
- 前端映射：`null` → 聊天区上方提示"请选择数字人"，MCP 列表为空（FR-032）。

### 1.6 `GET /api/agents/current/mcp` — MCP 服务状态

- 响应：`200 { agent_name: string | null, mcp_servers: [{ name, transport, status }] }`，
  `status ∈ 'connected' | 'failed' | 'unknown'`
- 未选中数字人 → `{ agent_name: null, mcp_servers: [] }`
- 错误：`404 AGENT_NOT_FOUND` — 已选中但该数字人配置损坏
- 前端映射：`connected` → 绿色 + "连接正常"；`failed` → 红色 + "连接失败"；`unknown` → 灰色 + "未连接"（FR-033、D14）。
- **实例未创建或首次建连进行中时为 `unknown`，MUST NOT 呈现为 `failed`**（2026-09-11 修订：原契约规定为 `failed`，会把"尚未建连"误读为断线故障）；任何状态前端**不做**弹窗或阻断（FR-034、FR-038）。
- 刷新时机：进入会话时拉取一次；此后经 SSE 订阅实时更新（见 §1.7，2026-09-12 修订：替代原 ≤5s 轮询）。

### 1.7 `GET /api/agents/current/mcp/events` — MCP 状态推送（SSE）

- 响应：`200 text/event-stream`；事件名 `mcp-status`，`data` 负载与 §1.6 响应体相同
- 时序：连接建立即推送一次当前快照；之后每当后端状态变化（建连落定、连接断开、select/exit 切换选中）重算快照再推；25s 心跳注释行保活
- 断线语义：`connected` 为真实活性——MCP 连接意外断开时后端立即标记 `failed` 并推送（2026-09-12 新增：修复绿灯假阳性）；后端自动有界重连，server 恢复后推送 `connected`（重连 5 次全败时于下次使用惰性自愈，前端无感知）
- 前端映射：挂载聊天面板后订阅一次，卸载时关闭；EventSource 断线自动重连，**不再轮询** §1.6（SC-010 的 ≤5s 滞后由事件推送保证，实际近实时）

---

## 2. 模型

### 2.1 `GET /api/models`

- 响应：`200 { models: [{ model, is_default }] }`
- `is_default` 由后端以 `config.yaml` 的默认模型名逐项比较得出：**正常配置下恰一项为 `true`**；
  若配置中出现重复模型名则可能多项，前端**不得**假设唯一（展示时以第一项为准）。
- 前端映射：`ModelPicker` 展示列表并标注"默认"；当前选择存 `sessionStorage`（键 `optagent.model`），
  若缓存值不在返回列表中则回退为默认项。
- 为**请求级**参数：随每条消息提交，缺省即使用默认模型（FR-013）。

---

## 3. 会话

### 3.1 `POST /api/threads` — 创建

- 请求：`{ agent_name }`（`additionalProperties: false`）
- 响应：`201 { thread_id, title, created_at }`
  - 注意：**不返回** `agent_name` 与 `updated_at`；新会话 `title` 恒为 `null`
- 错误映射：

| 状态码 | code | 触发条件（源码口径） | 前端提示 |
|---|---|---|---|
| 409 | `AGENT_NOT_SELECTED` | 未选中任何数字人 | "请先选择数字人"（FR-042、US5 场景 5） |
| 404 | `AGENT_NOT_FOUND` | 该数字人配置不存在或损坏 | "数字人不存在或配置异常" |

- **重要**：本接口**不再返回** `THREAD_BUSY_LIMIT`（原"会话总数 ≥ 3 即拒绝创建"的口径已移除）；
  该错误码现只由**发消息**接口按**并发上限**（同一用户活跃 run ≥ 3，跨数字人累计）返回（见 §4.1）。
- **不限会话总数**：可以连续创建任意多个会话，数量不再构成创建失败的原因。
- 前端行为：成功后插入历史列表头部并选中该会话；失败时保留当前视图并提示。

### 3.2 `GET /api/threads?agent_name=` — 列表

- 查询参数：**仅 `agent_name`（可选）**，`additionalProperties: false`
- 响应：**顶层数组** `[{ thread_id, agent_name, title, created_at, updated_at }]`，后端按 `updated_at` 倒序
- **`title` 由后端回落**：`meta.title` 为空时回落到"首条 user 消息前 20 字（按 Unicode 码点计）"；
  仅在**该会话从未发过用户消息**时才为 `null`
- **该接口不支持 `limit` / `offset`**（见 §7 差异 2）：
  - 前端**必须一次性拉取全部会话**，在**前端做切片**：默认展示前 10 条，"更多"展示前 100 条（FR-039、FR-040、SC-014）。
  - **MUST NOT** 向该接口传 `limit` / `offset`：**未声明参数会被静默丢弃，不会报错**（详见 §7 差异 2）。
    传了拿不到分页效果，却容易误以为分页已生效——属**静默错误**，比 400 更危险。
- 前端映射：`title === null` → 展示"新会话"。

### 3.3 `GET /api/threads/{thread_id}?limit=50&offset=0` — 详情

- 参数（**该接口支持分页**）：`limit` 默认 50 / 最大 200 / 最小 1；`offset` 最小 0，**从最新往前数**
- 响应：
  `{ thread_id, agent_name, title, created_at, updated_at, total, messages: Message[], running }`
  - `title` 同样由后端回落（同 §3.2）
  - `total` 为该会话消息**全量**条数
  - `running` = 该会话当前是否有活跃 run（`runManager.hasActive(threadId)`）
- `messages` 元素字段：

| 字段 | 必现 | 说明 |
|---|---|---|
| `id` | 是 | 新行为服务端生成 ID；**旧数据行由后端合成为 `{threadId}-{全局序号}`**（序号从最早开始自 1 递增）。反馈接口必须使用该 `id` |
| `role` | 是 | `user` \| `assistant` |
| `content` | 是 | 正文；失败轮的 assistant 行 `content` 为空字符串 |
| `ts` | 是 | ISO8601；旧数据回填为会话创建时间 |
| `status` | 否 | 仅 assistant 有；`completed` \| `failed`（缺省视为 `completed`） |
| `usage` | 否 | 仅 assistant 完成/失败轮 |
| `duration_seconds` | 否 | 由 `duration_ms` 换算：`Math.round(duration_ms) / 1000` → **最多 3 位小数**（见 §7 差异 4） |
| `attachments` | 否 | 仅带 `@` 引用的 user 消息 |
| `error` | 否 | 仅 `status='failed'` |
| `agent_name` | 否 | **2026-09-10 新增**：该轮回答的数字人；会话可跨数字人，user/assistant 成对返回（旧数据缺省） |
| `feedback` | 是 | 恒返回，默认 `null` |

- **任何消息不含思考内容与工具调用信息**（后端 FR-009，对应前端 SC-018）。
- 前端映射：
  - 分页：滚动加载更早消息时 `offset += limit` 再次请求并**前插**（边界情况：历史 >100 条）。
  - `running === true` 且本地无活跃流（如刷新后重入）→ 提供"重新获取本轮结果"入口（FR-050、SC-020）。
  - `status === 'failed'` → 展示 `error` 映射文案（FR-049）。
  - `attachments` 存在 → 正文渲染 `@文件名` 引用（FR-016 还原）。
  - **耗时展示统一由前端格式化为 1 位小数**（后端精度不固定）。

### 3.4 `PATCH /api/threads/{thread_id}` — 重命名

- 请求 `{ title }`（1–100 字）→ `200 { thread_id, title }`
- 本期 UI **不提供**重命名入口（规范未要求），接口保留供后续使用；不实现即不产生 UI 契约。

### 3.5 `DELETE /api/threads/{thread_id}` — 删除

- `204` 无响应体
- 服务端行为：**先 stop 进行中的 run**（丢弃本轮但已消耗 token 仍计入用量），
  再删除会话目录，并连带清理 `tmp/` 下 `{thread_id}_` 前缀文件
- 错误：`404 THREAD_NOT_FOUND`
- 前端行为：删除前二次确认；成功后从列表移除并切换到相邻会话或空态。

### 3.6 `PUT /api/threads/{thread_id}/messages/{message_id}/feedback`

- 请求：`{ value: 'up' | 'down' | null }`（`additionalProperties: false`）
- 语义：单值覆盖保证互斥；**重复提交同值 = 取消（置 `null`）**（FR-027）
- 响应：`200 { message_id, feedback }`
- 错误：`404 THREAD_NOT_FOUND`、`404 MESSAGE_NOT_FOUND`、`400 VALIDATION_FAILED`（非法 value）
- 前端实现：本地乐观更新 + 失败回滚；点击时若当前值相同则提交 `null`。
- **`message_id` 必须是 §3.3 返回的 `id`**（含旧数据的合成 ID），否则会 `404 MESSAGE_NOT_FOUND`。

---

## 4. 发消息（SSE 流式）

### 4.1 `POST /api/threads/{thread_id}/messages`

**请求体**（`additionalProperties: false`）

| 字段 | 必选 | 约束 | 前端构造规则 |
|---|---|---|---|
| `content` | 是 | `minLength: 1` | textarea 文本去掉 `@文件名` 引用文本后的正文（FR-016） |
| `thinking` | 否 | boolean | 思考开关状态；后端缺省 `false`（快速模式）（FR-012） |
| `model` | 否 | `minLength: 1` | 当前选中模型；未选择时**不传该字段**，由后端用默认模型（FR-013） |
| `attachments` | 否 | `maxItems: 10`，元素 `{dir, filename}` 且 `additionalProperties: false` | 结构化引用（FR-017、SC-019） |

**响应**：`200 text/event-stream`（服务端 `writeHead` 后 `hijack`，`done`/`error` 后 `end()`）

**错误映射（按源码判定链顺序）**

| 状态码 | code | 触发条件 | 前端提示与行为 |
|---|---|---|---|
| 404 | `THREAD_NOT_FOUND` | 会话不存在 | "会话不存在或已被删除" |
| 409 | `AGENT_NOT_SELECTED` | 未选中数字人 | "请先选择数字人" |
| 409 | `THREAD_BUSY_LIMIT` | **该用户活跃 run ≥ 3（跨数字人累计）且本会话无进行中 run** | "系统繁忙，请稍后重试" |
| 409 | `POOL_EXHAUSTED` | 数字人实例池已满 | "系统繁忙，请稍后重试" |
| 409 | `THREAD_RUN_ACTIVE` | 本会话已有进行中 run | "该会话已有进行中的回复"；发送按钮保持置灰（FR-006 兜底） |
| 404 | `AGENT_NOT_FOUND` | 数字人配置损坏（创建会话/选中时校验） | "数字人不存在或配置异常" |
| 400 | `MODEL_NOT_FOUND` | `model` 未命中 `GET /api/models` | "所选模型不可用，请重新选择"；**保留用户输入**（US3 场景 7） |
| 400 | `FILE_REF_NOT_FOUND` | 引用文件不存在 | "引用的文件不存在，请重新选择"；不发送（FR-018） |
| 400 | `VALIDATION_FAILED` | 目录/文件名含穿越特征、`content` 为空等 | 提示参数非法 |
| 403 | `UPLOAD_DIR_FORBIDDEN` | 引用目录不在 9 目录白名单 | "该目录不允许引用" |

- **注意**：`THREAD_BUSY_LIMIT` **只由本接口产生**，判定是"该用户活跃 run 数 ≥ 3（跨数字人累计）且本会话无活跃 run"；创建会话接口不再返回该码（见 §3.1、§7 差异 6）。
- **2026-09-10 修订**：本接口**不再**因"会话所属数字人 ≠ 当前选中"而拒绝——**会话不绑定数字人**，
  本轮由**当前选中数字人**执行（同一会话内可切换，切换在下一轮生效），响应消息逐条带 `agent_name`。

### 4.2 SSE 事件 → 前端状态（契约）

服务端按 `event: {type}\ndata: {JSON}\n\n` 写入，事件类型与数据以下表为准。

| event | data | 前端处理 |
|---|---|---|
| `thinking` | `{ delta }` | `streamingThinking += delta`；**仅当本轮 `thinking === true` 时渲染**；不落历史（FR-021、FR-023） |
| `content` | `{ delta }` | `streamingText += delta`（FR-001 流式展示） |
| `tool_call` | `{ call_id, name, status: 'running' }` | `toolCalls.push({ call_id, name, status: 'running' })`；**仅展示 `name`**，入参与结果永不展示（FR-005、SC-011） |
| `tool_call_end` | `{ call_id, status: 'success' \| 'error' }` | 从 `toolCalls` 移除该 `call_id` → 展示消失（FR-005） |
| `done` | `{ finish_reason, usage: {input_tokens, output_tokens}, duration_seconds, message_id, agent_name }` | `finish_reason === 'stop'`（中断，`message_id` 为 `null`）→ 按中断处理，不展示操作与用量；`'completed'` → 记录 `usage`/`duration_seconds`/`agent_name`，并用 §3.3 刷新消息（FR-025、FR-028） |
| `error` | `{ error: {code, message}, duration_seconds?, usage?, agent_name }` | 聊天区展示错误文案；`duration_seconds`/`usage`/`agent_name` 一并记录（FR-049） |

**字段细节**:

- `done.finish_reason` 取值：`'completed'`（正常）或 `'stop'`（本轮被中断丢弃，不落盘）。
- `duration_seconds` 由后端 `Math.round(ms) / 1000` 计算 → **精度不固定（最多 3 位小数）**，
  与文档所述"1 位小数"不符；**前端展示时统一格式化为 1 位小数**（见 §7 差异 4）。
- `error.duration_seconds` 与 `error.usage` 均为**可选**：本轮已消耗可统计时提供。
- **2026-09-10 新增**：`done.agent_name` / `error.agent_name` 为本轮回答的数字人（会话可跨数字人）；
  前端在流式气泡上标注（`streamingAgentName` 发送时快照，`done` 事件落定），历史消息逐条标注。

**时序不变式（前端 MUST 容忍）**: `thinking*` → `content*`（可穿插成对 `tool_call`/`tool_call_end`）→
恰好一个终结事件（`done` 或 `error`）。

**断连语义**: 服务端在客户端断开时仅执行 `unsubscribe`（退订事件流），**本轮继续在服务端执行并落盘**。
前端读取循环异常结束 → 标记本轮为 `failed`，提示"连接已断开，本轮仍在服务端继续执行"，
提供"重新获取"操作 → 调 §3.3 拉取历史（以 `running` 判断是否仍在进行）（FR-050、SC-020）。
前端**不自动重连**、不续推。

### 4.3 `POST /api/threads/{thread_id}/stop` — 中断本轮

- 响应：`200 { stopped: boolean }`（无进行中 run 时幂等返回 `false`）
- 错误：`404 THREAD_NOT_FOUND`
- 前端行为：点击"中断本轮"→ 调该接口 → 关闭本地流读取 → 本轮不展示操作按钮与用量（FR-007、FR-028）。
- 语义：本轮不落盘（`done.finish_reason='stop'`、`message_id=null`）；已消耗 token 仍计入用量（前端不展示该轮用量）。

---

## 5. 文件

### 5.1 `POST /api/files/upload`（multipart）

- 字段：`file`（**单文件**）、`dir`（9 个白名单目录之一，见 §6）
- 限制：≤50MB（`uploadMaxMb`）；扩展名 ∈ `.csv .xlsx .txt .json .pdf`
- 响应：`201 { dir, filename, size }`
  - `filename` 为落盘名：`{原文件名}_{YYYYMMDD_HHMMSS}{.ext}`；
    **同名碰撞时追加 `-1`、`-2`…**（前端 MUST 以响应中的 `filename` 为准，不得自行拼接）
- 错误映射：

| 状态码 | code | 触发条件 | 前端提示 |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | 非 multipart；扩展名不在白名单；缺少 `file` 字段；缺少 `dir` 字段 | "文件格式不支持" / "参数缺失" |
| 403 | `UPLOAD_DIR_FORBIDDEN` | `dir` 不在 9 目录白名单 | "该目录不允许上传" |
| 413 | `FILE_TOO_LARGE` | 超过 50MB | "文件超过 50MB" |

- 前端规则：
  - 客户端预校验扩展名与大小，不合规**不发请求**（FR-010）。
  - **该接口一次只接受一个文件**（后端逐 part 处理，多 `file` part 时仅最后一个生效）：
    前端多选时**必须为每个文件各发一次请求**，各自独立状态与重试（FR-010、FR-011）。
  - 失败项 MUST 展示原因并提醒重试（FR-011、SC-013）。

### 5.2 `GET /api/files/list?dir=`

- 响应：**顶层数组** `[{ filename, size, updated_at }]`（后端已过滤目录项）
- 错误：`400 VALIDATION_FAILED`（缺 `dir`/含穿越）、`403 UPLOAD_DIR_FORBIDDEN`（非白名单）
- 前端用途：`@` 引用面板的文件列表、上传成功后的目录刷新；`dir` 含 `tmp`。

### 5.3 `GET /api/files/download?dir=&filename=`

- `200` 文件流：`Content-Type: application/octet-stream` + `Content-Disposition: attachment`
- **无大小上限**（与 §5.4 预览不同）
- 错误：`400 VALIDATION_FAILED`（非法文件名）、`403 UPLOAD_DIR_FORBIDDEN`、`404 FILE_NOT_FOUND`
- 前端实现：以 `<a :href download>` 触发，不经 `fetch`（避免大文件占用内存）。

### 5.4 `GET /api/files/preview?dir=&filename=`

- `200`，`Content-Disposition: inline`；Content-Type 按扩展名映射：

| 扩展名 | Content-Type | 前端渲染方式 |
|---|---|---|
| `.txt` | `text/plain; charset=utf-8` | `fetch` 文本 → `<pre>` |
| `.csv` | `text/csv; charset=utf-8` | `fetch` 文本 → `<pre>` |
| `.json` | `application/json; charset=utf-8` | `fetch` 文本 → `<pre>` |
| `.pdf` | `application/pdf` | `<iframe :src>` 内联渲染 |
| 其他（含 `.xlsx`） | `application/octet-stream` + `attachment` | **回退下载**（FR-047） |

- 预览大小上限：`previewMaxMb`（默认 10MB），超限 → `413 FILE_TOO_LARGE`
- 错误映射：
  - `413 FILE_TOO_LARGE` → 预览区提示"文件过大，请下载查看"并给出下载按钮（FR-048）
  - `404 FILE_NOT_FOUND` → "文件不存在或已被清理"（如 `tmp` 清理）
  - `403 UPLOAD_DIR_FORBIDDEN` → "该目录不支持预览"
  - `400 VALIDATION_FAILED` → "参数非法"
- 前端实现：文本类**按需 `fetch`**（不直接用 `<iframe>`，以便展示错误态与统一错误文案）；
  `.pdf` 直接用 `<iframe :src>`（浏览器原生渲染，无法读取错误体，加载失败以 `onerror` 兜底）。
- **2026-09-10 联调实测（已修复）**: `.pdf` 交给 `<iframe>` 后前端读不到响应体，
  若文件超过 `previewMaxMb`，iframe 只会渲染成浏览器错误页（且浏览器通常**不触发 `error` 事件**，
  无法用 `onerror` 兜底）→ 用户既看不到"文件过大"也无下载入口，FR-048 在 PDF 路径上曾不满足。
  **修复**：`usePreview.openFile` 对 `.pdf` **先调用 `files.probePreview()` 预检一次**
  （`GET /api/files/preview` 只取状态、成功后立刻 `body.cancel()` 不下载），
  非 2xx 时解析错误体 → `renderMode='error'` + 下载引导；2xx 才把直链交给 `<iframe>`。
  文本类路径不变（本来就 `fetch` 内容，天然能拿到 413）。两条路径均有单测与联调用例覆盖。

### 5.5 `GET /api/files/workspace`

- 响应：`{ dirs: [{ dir, files: [{ filename, size, updated_at }] }] }`
- 后端**固定返回全部 9 个白名单目录**，空目录 `files` 为 `[]`（FR-031、FR-019）
- 目录运行中被删除时按空目录容错，不报错

### 5.6 `DELETE /api/files?dir=&filename=`

- 语义：删除工作空间中的单个文件（FR-053 ~ FR-055）
- 响应：`200 { dir, filename, deleted: true }`
- 错误：
  - `400 VALIDATION_FAILED`（缺参 / 非法文件名 / 含穿越）
  - `403 UPLOAD_DIR_FORBIDDEN`（`dir` 不在白名单）
  - `403 FILE_READONLY`（`dir=shared` —— 共享目录只读）
  - `404 FILE_NOT_FOUND`（文件不存在或已被清理）
- 前端实现：经 `files.remove()` 发起；成功后**就地移除**该条目（不重拉 `workspace`）并 toast 提示；
  若面板正以内容态展示该文件，删除成功后 MUST 退回列表态（FR-055）。
- 安全：后端走 `FileAccess.remove()` → `resolveSafe()`，与读取路径共用「穿越 / 符号链接 / 白名单」校验。

---

## 6. 空间目录白名单（9 个，与后端同源）

后端常量来源：`agent-backend/src/domain/dirs.ts`

- `BUSINESS_DIRS`（7 个，顺序固定）：`生产计划`、`产线信息`、`切换时间`、`求解时间`、`产线电价`、`目标优先级`、`使用规则`
- `SHARED_DIR`：`shared`
- `TMP_DIR`：`tmp`

后端三处白名单均为此 9 个：上传（`UPLOAD_DIRS`）、列表/下载/预览（`LIST_DIRS`）、`@` 引用（`ATTACHMENT_DIRS`）。
前端对应常量：`src/constants/directories.ts`（唯一来源，三处 UI 共用，对应 SC-021）。

> `user-data/` 下还存在 `threads` 目录，但它是会话存储目录，**不属于**用户可见的空间目录，前端不得展示。

---

## 7. 已知差异与契约缺口（2026-09-10 源码核对）

以下为**前端设计依据**：一律以源码为准。同时建议后端修订文档/实现，前端在联调时按此表验收。

**行号前缀约定**：`文档:` 相对 `agent-backend/specs/002-agent-chat-ui/`；`源码:` 相对 `agent-backend/`。
行号基于 2026-09-10 工作区快照（`agent-backend/src`，Fastify + TS），仅供定位，不保证随代码演进仍精确。

| # | 后端文档表述 | 源码实际行为 | 证据（文档 / 源码） | 前端应对 |
|---|---|---|---|---|
| 1 | `contracts/http-api.md:30`："`dir` 白名单扩展为 **10 个**：7 业务目录 + shared + tmp" | 实际为 **9 个**；同一文档 `http-api.md:73` 又写"固定返回全部 **9 个**白名单目录"，自相矛盾 | **文档**：`contracts/http-api.md:30`（10 个）vs `contracts/http-api.md:73`（9 个）<br>**源码**：`src/domain/dirs.ts:13-25`（`BUSINESS_DIRS` 7 个 + `SHARED_DIR` + `TMP_DIR`）、`src/routes/files.ts:24-25`（`UPLOAD_DIRS` = `LIST_DIRS` = 7+shared+tmp）、`src/routes/chat.ts:26`（`ATTACHMENT_DIRS`）——三处均 **9 个**；`src/routes/files.ts:3` 文件头注释亦写"7 业务目录+shared+tmp" | 前端按 **9 个**实现（已对齐）；建议后端修正文档笔误 |
| 2 | `contracts/http-api.md:77`："`POST /api/threads`、`GET /api/threads`（默认 10 条/更多 100 条**由前端 limit/offset 控制**）" | 该接口**不接受** `limit`/`offset`：传参会**被静默丢弃、不报错**（Fastify 默认 `removeAdditional: true`，`server.ts:168` 未覆写 ajv 配置）；列表返回全部并按 `updated_at` 倒序。<br>**2026-09-10 联调实测**：`GET /api/threads?limit=10` → `200` 且响应体与不带参**完全一致**（参数被丢弃）；`GET /api/threads/{id}?limit=999` → `400`（证明 schema 本身有效，只是未声明参数被丢弃而非拒绝） | **文档**：`contracts/http-api.md:77`<br>**源码**：`src/routes/threads.ts:26-30`（`listQuerySchema` 仅声明 `agent_name` + `additionalProperties: false`）、`src/routes/threads.ts:86-90`（`threadStore.list()` 直接返回全部）<br>**对照**：`src/routes/threads.ts:32-39`（只有**详情**接口 `detailQuerySchema` 才有 `limit` 1–200 / `offset`） | 前端**一次性拉全部**，在**前端切片** 10 / 100 条（FR-039、FR-040 仍可满足） |
| 3 | `contracts/http-api.md:79`："`POST /api/agents/:name/select`（409 即"会话进行中禁止切换"）"；后端 spec `FR-021` 要求"存在进行中会话时切换数字人 MUST 被拒绝" | 409 `AGENT_SWITCH_REQUIRED` 的触发条件是"**已选中另一个数字人**"，与"会话是否进行中"**无关**；`exit` 也不检查进行中会话 | **文档**：`contracts/http-api.md:79`<br>**源码**：`src/routes/agents.ts:38-56`（整个 handler 仅捕获 `AgentSwitchRequiredError`，**全文无 `runManager` 引用**）、`src/routes/agents.ts:58-63`（`POST /api/agents/current/exit` 同样只清选中态） | FR-036（进行中禁止切换）由**前端 UX 约束**承担（置灰 + 不发请求）；后端无兜底。**2026-09-10 修订**：`select` 改为**覆盖式**（切换无需先 exit，`AGENT_SWITCH_REQUIRED` 已移除）；会话不绑定数字人，后端 FR-021"进行中拒绝切换"的旧要求已废止，本条差异消解 |
| 4 | `contracts/sse-events.md:57`、`research.md:15`、`tasks.md:60`："`duration_seconds` 为整轮耗时，**1 位小数**" | 实现为 `Math.round(ms) / 1000` → 精度**最多 3 位小数** | **文档**：`contracts/sse-events.md:57`、`research.md:15`、`tasks.md:60`<br>**源码**：`src/domain/run-manager.ts:157-159`（`toSeconds()`）、`src/routes/threads.ts:115`（历史 `duration_ms` → `duration_seconds` 换算） | 前端统一经 `formatDuration()` **格式化为 1 位小数**展示；不依赖后端精度 |
| 5 | 未明确说明 | `POST /api/files/upload` 逐 part 处理，**多个 `file` part 时仅最后一个生效**（前一个 staging 被覆盖） | **源码**：`src/routes/files.ts:107-144`（`for await (const part of parts)` 内 `staging` / `originalName` / `savedSize` 被**反复覆盖**，循环结束只保留最后一个 `file` part） | 前端多选时**逐文件各发一次请求**，串行或有限并发 |
| 6 | 文档未区分 | **2026-09-10 修订**：`THREAD_BUSY_LIMIT` 现在**只有一套判定**——发消息时该用户**活跃 run 数** ≥ 3（跨数字人累计）且本会话无活跃 run；创建会话**不再设会话总数上限**（原 `countByAgent ≥ 3` 判定已从 `POST /api/threads` 移除）。<br>**2026-09-10 修订**：`AGENT_SWITCH_REQUIRED` 已**整体移除**（select 为覆盖式、会话不绑定数字人、发消息改用当前选中数字人，不再有"所属数字人"比对） | **发消息**：`src/routes/chat.ts:106-111`（`runManager.activeThreadCount()` ≥ `MAX_ACTIVE_THREADS_PER_USER`，常量 `= 3` 见 `src/routes/chat.ts:23`）；`src/domain/run-manager.ts:174-183`<br>**创建**：`src/routes/threads.ts`（已无 `THREAD_BUSY_LIMIT` 抛出点；`threadStore.countByAgent()` 保留但不再用于限流）<br>**`AGENT_SWITCH_REQUIRED`**：源码中已无该错误码（`src/domain/current-agent.ts` 覆盖式 select；`src/routes/chat.ts` 无会话-数字人比对） | 前端按 `code` 给**场景化文案**；`THREAD_BUSY_LIMIT` 统一提示系统繁忙 |

---

## 8. 不在本期前端范围

以下后端接口本期前端**不消费**，不产生 UI 契约，避免范围蔓延：

- `GET /api/monitor/agents`、`GET /api/monitor/health`（内网只读监控，非用户工作台功能）
- `GET /api/usage/summary`（用量聚合报表，规范未要求；消息级用量已由会话详情提供）
- `PATCH /api/threads/{id}`（重命名，规范未要求 UI 入口）
