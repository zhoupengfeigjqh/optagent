# Phase 1 数据模型：前端实体与状态模型

**功能**: 001-agent-chat-ui | **日期**: 2026-09-10 | **依据**: [spec.md](spec.md) 关键实体章节、[contracts/backend-api.md](contracts/backend-api.md)

本文件描述前端视角的数据模型：**领域实体**（与后端契约一一映射，定义于 `src/api/types.ts`）
与**前端状态模型**（仅存在于内存，定义于 `src/composables/`）。
前端无持久化存储，服务端为唯一数据源；所有实体字段名与后端 JSON 字段保持一致（下划线命名），
前端不做法语化重命名，以降低契约映射成本。

---

## 一、领域实体

### 1. 空间（Space）与场景子目录（Scenario Sub-dir）

**来源**: `GET /api/files/workspace` 下发（**2026-09-14 修订**：原为前端常量 `src/constants/directories.ts`，该文件已删除；前端 MUST NOT 保留目录常量）

**Space**（一级）

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 空间名（一级目录）：`数据准备` / `共享空间` / `临时空间` |
| `agent_writable` | `boolean` | Agent 是否可写（仅 `临时空间` 为 `true`） |
| `upload_extensions` | `string[]` | 该空间允许上传的扩展名（小写含点），前端预校验的白名单来源 |
| `dirs` | `WorkspaceDir[]` | 数据准备为场景子目录清单；共享空间 / 临时空间仅含空间自身一项 |

**Scenario Sub-dir**（二级；扁平空间即空间自身，见 `WorkspaceDir`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `dir` | `string` | 相对空间路径（如 `数据准备/生产计划`；扁平空间为 `共享空间` / `临时空间`） |
| `label` | `string` | 展示名（数据准备子目录为子目录名，扁平空间为空间名） |
| `deletable` | `boolean` | 用户是否可删除其中文件（共享空间为 `false`） |
| `files` | `{ filename, size, updated_at }[]` | 文件清单，空目录为 `[]` |

**规则**:

- 一级空间**固定三个**（数据准备 / 共享空间 / 临时空间）；数据准备下的二级子目录由场景配置（`users/{userId}/scenario.json` 的 `data_prep_dirs`，经接口下发，运行期热加载）定义，**前端 MUST NOT 硬编码**（FR-009、FR-014、FR-031、SC-021）。
- **扁平空间判定**：`dirs.length === 1 && dirs[0].dir === name` 者为扁平空间（共享空间 / 临时空间），展开后直接出文件；该判定 MUST 由唯一纯函数提供（`src/utils/space.ts` 的 `isFlatSpace`），`@` 面板与文件空间树共用。
- 上传入口、`@` 文件选择、工作空间文件三处 MUST 消费同一接口下发的同一份数据，不得各自维护不同口径（FR-009a、SC-021）。
- 场景未配置或接口失败（503 `SCENARIO_NOT_CONFIGURED`）时，三处 MUST 展示明确原因与重试入口，MUST NOT 以空态静默替代（FR-009a）。

---

### 2. 会话（Conversation / Thread）

**来源**: `POST /api/threads`、`GET /api/threads`、`GET /api/threads/:id`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `thread_id` | `string` | 是 | 会话标识（服务端 UUID） |
| `agent_name` | `string` | 是 | 所属数字人 |
| `title` | `string \| null` | 是 | 标题；服务端取首条用户消息前 20 字，未发消息时为 `null` |
| `created_at` | `string` | 是 | ISO8601 |
| `updated_at` | `string` | 是 | ISO8601，列表按此倒序 |
| `total` | `number` | 否 | 仅详情返回，消息全量条数 |
| `messages` | `Message[]` | 否 | 仅详情返回，按时间正序 |
| `running` | `boolean` | 否 | 仅详情返回，本轮是否仍在进行 |

**前端派生**:

- `displayTitle`：`title` 为空时展示"新会话"（FR-044 的兜底展示）。
- `isActive`：是否为当前选中会话。

**规则**:

- 左侧列表：`GET /api/threads` **不接受 `limit`/`offset`**（Schema `additionalProperties: false`，传参会被拒绝）。
  前端 MUST 一次性拉取全部会话，在**前端切片**：默认展示前 10 条，"更多"展示前 100 条（FR-039、FR-040、SC-014）。
- 详情分页 `limit` 默认 50、上限 200，`offset` 从最新往前数；滚动加载更早消息时按 `offset` 递增（边界情况：历史 >100 条）。
- 进行中会话在列表中展示"进行中"标记；删除/切换进行中会话前 MUST 先提示。

---

### 3. 消息（Message）

**来源**: `GET /api/threads/:id` 的 `messages[]`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | 是 | 消息标识（反馈接口使用；旧数据由服务端合成） |
| `role` | `'user' \| 'assistant'` | 是 | 角色 |
| `content` | `string` | 是 | 正文（不含 `@` 引用标注文本） |
| `ts` | `string` | 是 | ISO8601 |
| `status` | `'completed' \| 'failed'` | 否 | 仅 assistant 完成轮返回 |
| `usage` | `Usage` | 否 | 仅 assistant 完成轮返回 |
| `duration_seconds` | `number` | 否 | 整轮耗时（秒）；后端由 `Math.round(duration_ms)/1000` 得出，**精度不固定（最多 3 位小数）**，前端统一格式化为 1 位小数展示 |
| `attachments` | `FileReference[]` | 否 | 仅带 `@` 引用的 user 消息返回 |
| `feedback` | `'up' \| 'down' \| null` | 是 | 恒返回，默认 `null` |
| `error` | `ErrorInfo` | 否 | 失败轮返回 |

**规则（与 FR 对应）**:

- 思考内容与工具调用信息 **MUST NOT** 出现在该模型中——从类型层面杜绝落历史（FR-023、SC-018）。
- 仅当 `status === 'completed'` 且 `id` 存在时，才展示复制/点赞/点踩与用量（FR-024、FR-025、FR-028）。
- `status === 'failed'` 时展示 `error` 文案（`error-message.ts` 映射），不展示点赞/点踩（FR-049）。
- user 消息含 `attachments` 时，正文内以 `@文件名` 形式**展示**引用（由 `attachments` 还原，不依赖 content 文本）。

**前端派生**: `segments`（见 §4）、`formattedTime`、`formattedDuration`、`formattedUsage`。

---

### 4. 内容分段（ContentSegment）

**来源**: 前端纯函数 `src/utils/segments.ts` 的派生结果（非后端字段）| **对应**: FR-045、FR-029、FR-030

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | `'text' \| 'link' \| 'mark'` | 分段类型 |
| `text` | `string` | 片段文本 |
| `href` | `string` | 仅 `link`：外链地址 |
| `matchIndex` | `number` | 仅 `mark`：全局匹配序号（用于逐次跳转定位） |

**规则**:

- 输入 = `content` + 可选 `keyword`；输出为有序、无重叠、可拼接还原原文的分段数组（可测不变式）。
- `link` 仅识别 `http://` / `https://` 开头的地址；点击 MUST 直接跳转（`target="_blank"` + `rel="noopener noreferrer"`），不在右侧预览区打开（FR-045）。
- 搜索结果以 `mark` 呈现（黄色高亮），`matchIndex` 与 `useSessionSearch` 的全局序号对齐（FR-029、FR-030）。
- 派生结果 MUST 以 `computed` 缓存，禁止在模板中重复计算（宪章原则五）。

---

### 5. 文件引用（FileReference）

**来源**: 发消息请求体 `attachments` | **对应**: FR-016、FR-017、FR-018

| 字段 | 类型 | 说明 |
|---|---|---|
| `dir` | `string` | 三个空间之一（数据准备含场景子目录，如 `数据准备/生产计划`；共享空间 / 临时空间即空间名） |
| `filename` | `string` | 目录内的文件名 |

**规则**:

- 单条消息 ≤ 10 个；超出时 MUST 阻止继续添加并提示上限（FR-017、SC-019）。
- 提交前 MUST 校验文件仍存在于工作空间清单；不存在则提示且不发送（FR-018）。
- 提交时 MUST 以结构化对象提交，MUST NOT 仅把 `@文件名` 当纯文本（FR-016）。

---

### 6. 用量（Usage）与错误（ErrorInfo）

**Usage**（来源：`done`/`error` 事件与会话详情）

| 字段 | 类型 | 说明 |
|---|---|---|
| `input_tokens` | `number` | 输入 token |
| `output_tokens` | `number` | 输出 token |

**ErrorInfo**

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | `string` | 后端错误码（见 `docs/api.md` 错误码一览） |
| `message` | `string` | 后端原始文案（仅作兜底，不直接展示为主文案） |

**规则**: 展示文案 MUST 由 `utils/error-message.ts` 按 `code` 映射；未知码回退通用文案 + 原码（D13）。

---

### 7. 数字人（DigitalHuman）

**来源**: `GET /api/agents`、`GET /api/agents/:name`、`GET /api/agents/current`

| 字段 | 类型 | 说明 |
|---|---|---|
| `agent_name` | `string` | 名称 |
| `description` | `string` | 简介（列表接口返回） |
| `soul` | `string` | SOUL.md 全文（详情接口返回，展示为"描述"） |
| `skills` | `{ name, description }[]` | 技能 |
| `enabled_tools` | `string[]` | 已启用工具 |
| `mcp_servers` | `{ name, transport }[]` | 挂载的 MCP 服务（不含连接细节） |

**规则**:

- 未选定数字人时，聊天区上方 MUST 提示"需要选择数字人"，MCP 列表为空（FR-032、FR-033）。
- 会话进行中（`hasActiveRun === true`）时，切换入口 MUST 置灰并说明原因（FR-036）。
- 切换流程 MUST 为"退出当前 → 选定新数字人"，成功后提示"下一轮对话生效"（FR-037）。

---

### 8. MCP 服务状态（McpServiceStatus）

**来源**: `GET /api/agents/current/mcp`（进入会话时一次性拉取）+ `GET /api/agents/current/mcp/events`（SSE 持续推送）

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 服务名 |
| `transport` | `string` | 传输方式 |
| `status` | `'connected' \| 'failed' \| 'unknown'` | 连接状态 |

**规则**:

- `connected` → 绿色 + 文本"连接正常"；`failed` → 红色 + 文本"连接失败"；`unknown` → 灰色 + 文本"未连接"（FR-033、D14）。
- 实例未创建或首次建连进行中时为 `unknown`，前端 MUST NOT 视为异常弹窗，也 MUST NOT 呈现为失败（FR-034、FR-038）。
- 状态 MUST 在会话进行中与数字人建连后被刷新（2026-09-12 修订：SSE 事件推送，替代轮询；后端即时检测断线并推送，满足 SC-010 滞后 ≤ 5s，实际近实时）。

---

### 9. 模型（Model）

**来源**: `GET /api/models`

| 字段 | 类型 | 说明 |
|---|---|---|
| `model` | `string` | 模型标识 |
| `is_default` | `boolean` | 恰一项为 `true` |

**规则**: 为**请求级**参数，随每条消息提交；缺省使用默认模型（FR-013）。当前选择缓存于 `sessionStorage`。

---

### 10. 上传文档（UploadedDocument）

**来源**: 前端上传状态（提交结果来自 `POST /api/files/upload`）| **对应**: FR-010、FR-011、SC-013

| 字段 | 类型 | 说明 |
|---|---|---|
| `localId` | `string` | 前端生成的唯一键（列表渲染用） |
| `dir` | `string` | 目标目录（三个空间之一，数据准备含场景子目录） |
| `name` | `string` | 原始文件名 |
| `size` | `number` | 字节数 |
| `status` | `'pending' \| 'uploading' \| 'success' \| 'failed'` | 上传状态 |
| `serverFilename` | `string \| null` | 服务端落盘名（含时间戳） |
| `error` | `ErrorInfo \| null` | 失败原因 |

**状态迁移**:

```text
pending ──upload──▶ uploading ──201──▶ success
                        └──错误──▶ failed ──retry──▶ uploading
```

**规则**:

- 客户端预校验：扩展名 ∉ **目标空间的 `upload_extensions`**（数据准备仅 `.csv`/`.xlsx`；共享空间与临时空间另含 `.txt`/`.json`/`.pdf` 与图片）或 单文件 > 50MB → 直接置 `failed` 并给出原因，不发请求（FR-010、FR-011）；空间策略尚未取得时只校验大小，扩展名交后端兜底。
- **后端上传接口一次只接受一个文件**（多 `file` part 时仅最后一个生效）：多选时前端 MUST 为每个文件各发一次请求，各自独立状态与重试。
- 落盘名以响应中的 `filename` 为准（后端已追加 `_YYYYMMDD_HHMMSS` 并在重名时追加 `-1`/`-2`），前端 MUST NOT 自行拼接。
- `failed` 项 MUST 展示失败原因并提供"重试"（FR-011、SC-013）。
- 上传成功后可被 `@` 引用面板选中（FR-014）。

---

### 11. 工作空间（Workspace / WorkspaceSpace）

**来源**: `GET /api/files/workspace`

**响应**

| 字段 | 类型 | 说明 |
|---|---|---|
| `scenario` | `string` | 场景名（场景未配置 → 503 `SCENARIO_NOT_CONFIGURED`） |
| `spaces` | `WorkspaceSpace[]` | 三空间树：空间 → 数据准备场景子目录 → 文件（字段见 §1） |

**前端状态**（`useWorkspace` 持有）

| 字段 | 类型 | 说明 |
|---|---|---|
| `expandedSpaces` | `string[]` | 已展开的空间名，默认 `[]` 即全部收起（一级） |
| `expandedDirs` | `string[]` | 已展开的二级目录，默认 `[]` 即全部收起（二级） |

**规则**:

- MUST 返回三个空间；数据准备下的子目录数量与场景配置一致，空空间/空目录展示为空态（FR-031、FR-019、SC-021）。
- 界面结构 MUST 为**三层**：空间（一级）→ 数据准备场景子目录（二级）→ 文件；共享空间与临时空间为扁平空间，展开即直接列出文件（FR-031）。
- 一级与二级折叠状态分别由 `expandedSpaces` / `expandedDirs` 持有，**仅存活于本次会话内**；面板收起再展开、清单重拉均不重置（FR-031）。
- 打开加号上传入口或文件空间面板时若清单尚未取得，MUST 即时加载（FR-009a、FR-031）。
- 删除（`remove(reference): Promise<boolean>`）经 `DELETE /api/files` 完成，成功后就地移除条目并提示；**共享空间**界面不提供删除入口，后端兜底返回 `FILE_READONLY`（FR-053、FR-054）。

---

### 12. 工作空间面板（PanelView / PreviewTarget / PreviewContent）

**来源**: 前端状态 + `GET /api/files/preview` | **对应**: FR-001、FR-002、FR-045~FR-048、FR-053~FR-055

**面板外壳**（`usePreview` 持有，决定右侧 1/3 渲染哪一侧）

| 字段 | 类型 | 说明 |
|---|---|---|
| `open` | `boolean` | 面板是否展开；`false` 时右栏不占宽（FR-002） |
| `view` | `'list' \| 'content'` | 文件空间列表态 / 文件内容态，二者互斥不并存（FR-001、FR-046） |

**规则**: `openList()` → `open=true, view='list'`；`openFile(ref)` → `open=true, view='content'`；
`backToList()` 只切 `view` 并清空内容态（面板保持展开）；`close()` 收起并复位为列表态（FR-055）。

**PreviewTarget**（内容态的当前目标；列表态恒为 `none`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `kind` | `'none' \| 'file'` | `none` 表示内容态无目标 |
| `dir` | `string` | 文件所在目录（三个空间之一，数据准备含场景子目录） |
| `filename` | `string` | 文件名 |

**PreviewContent**（加载结果）

| 字段 | 类型 | 说明 |
|---|---|---|
| `renderMode` | `'text' \| 'pdf' \| 'download' \| 'error'` | 由 `utils/file-kind.ts` 按扩展名分派 |
| `text` | `string \| null` | 文本类内容（`.txt`/`.json`/`.csv`） |
| `url` | `string \| null` | `.pdf` 的 iframe 地址 |
| `error` | `ErrorInfo \| null` | 失败信息 |

**规则**:

- 外部地址（`http(s)://`）MUST NOT 进入该模型，直接 `window.open` 跳转，且 MUST NOT 改变 `open` / `view`（FR-045）。
- `.xlsx` → `download` 模式（FR-047）；超限（`413`）与不存在（`404`）→ `error` 模式并引导下载（FR-048）。
- 内容态展示中的文件被删除 → 退回列表态（`view='list'`，面板保持 `open`）（FR-055）。

---

## 二、前端状态模型（仅内存）

### 13. 本轮运行状态（RunState）

**定义位置**: `src/composables/useChatStream.ts` | **对应**: FR-005~FR-007、FR-020~FR-023、FR-049、FR-050

| 字段 | 类型 | 说明 |
|---|---|---|
| `phase` | `'idle' \| 'streaming' \| 'completed' \| 'failed' \| 'aborted'` | 本轮阶段 |
| `streamingText` | `string` | `content` 事件累积文本 |
| `streamingThinking` | `string` | `thinking` 事件累积文本（不落历史） |
| `toolCalls` | `ToolCallState[]` | 进行中的工具调用 |
| `thinkingEnabled` | `boolean` | 本轮是否为思考模式（决定是否展示思考块） |
| `startedAt` | `number` | 本地计时起点（仅用于兜底展示） |

**ToolCallState**

| 字段 | 类型 | 说明 |
|---|---|---|
| `call_id` | `string` | 配对键 |
| `name` | `string` | 工具名（**仅名称，无入参与结果**） |
| `status` | `'running' \| 'success' \| 'error'` | 进行/结束状态 |

**状态迁移（SSE 事件驱动）**:

```text
idle
 └─ send() ─▶ streaming
      ├─ thinking        : streamingThinking += delta        （仅 thinking:true 时）
      ├─ content         : streamingText += delta
      ├─ tool_call       : toolCalls.push({call_id,name,status:'running'})
      ├─ tool_call_end   : 从 toolCalls 中移除该 call_id        （展示消失）
      ├─ done(completed) : phase = 'completed' → 拉取会话详情刷新消息，记录 usage/duration/message_id
      ├─ done(stop)      : phase = 'aborted'   → 中断轮（message_id 为 null）：不展示操作按钮与用量
      ├─ error           : phase = 'failed'   → 展示错误文案；usage/duration 可选
      ├─ stop() 本地中止 : phase = 'aborted'   → 不展示操作按钮与用量
      └─ 流读取异常      : phase = 'failed'   → 提示断连，并支持"重新获取"（FR-050）
 └─ 完成后 ─▶ idle（允许下一轮）
```

**不变式**:

- `phase === 'streaming'` 时：发送按钮置灰（FR-006）、数字人切换置灰（FR-036）、展示"思考中"动效（FR-020）。
- `toolCalls` 为空数组时不渲染任何工具相关 DOM（SC-011）。
- `done` 时若 `message_id === null`（中断轮）→ 视为 `aborted`，不产生操作按钮与用量（FR-007、FR-028）。
- 事件时序 MUST 容忍：`thinking*` → `content*`（可穿插成对 `tool_call`/`tool_call_end`）→ 恰好一个 `done`/`error`。

---

### 14. 输入区状态（ComposerState）

**定义位置**: `src/composables/useFileMention.ts` + `Composer.vue` 局部状态

| 字段 | 类型 | 说明 |
|---|---|---|
| `text` | `string` | textarea 文本（展示层，含 `@文件名`） |
| `references` | `FileReference[]` | 已选引用（提交层，结构化） |
| `mentionOpen` | `boolean` | `@` 面板是否展开 |
| `mentionColumn` | `'space' \| 'dir' \| 'file'` | 面板当前列（空间 / 数据准备子目录 / 文件） |
| `activeSpace` | `string \| null` | 当前聚焦的空间 |
| `activeDir` | `string \| null` | 当前聚焦的目录（相对空间路径） |
| `activeIndex` | `number` | 面板键盘高亮项 |

**规则**:

- 删除触发符 `@` → 面板收起（US4 场景 8）；`references` 中对应项 MUST 同步移除。
- 引用达 10 个 → 拒绝新增并提示（FR-017）。
- 发送后 MUST 清空 `text` 与 `references`；发送失败 MUST 保留输入（FR-013 相关场景）。

---

### 15. 搜索状态（SearchState）

**定义位置**: `src/composables/useSessionSearch.ts` | **对应**: FR-029、FR-030、SC-009

| 字段 | 类型 | 说明 |
|---|---|---|
| `keyword` | `string` | 当前关键词 |
| `matches` | `{ messageId: string; index: number }[]` | 跨消息匹配清单（按文档顺序） |
| `activeIndex` | `number` | 当前定位序号，`-1` 表示未定位 |
| `isOpen` | `boolean` | 搜索栏是否展开 |

**规则**: "下一个" = `(activeIndex + 1) % matches.length`，到达末尾循环（FR-030）；无匹配展示无结果提示（US8 场景 3）。

---

### 16. 提示（Toast）

**定义位置**: `src/composables/useToast.ts`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 唯一键 |
| `level` | `'info' \| 'success' \| 'error'` | 级别（决定语义色） |
| `text` | `string` | 文案（来自 `error-message.ts` 或业务文案） |
| `action` | `{ label: string; run: () => void } \| null` | 可选操作（如"重试"） |

**规则**: 容器 `aria-live="polite"`，同一时刻最多展示 3 条，自动消失时长 4s，可手动关闭（D14）。

---

## 三、实体关系

```text
DigitalHuman 1 ──n McpServiceStatus
DigitalHuman 1 ──n Conversation           （单用户并发会话上限 3，按 userId 跨数字人累计）
Conversation 1 ──n Message
Message      1 ──0..1 Usage
Message      1 ──0..1 ErrorInfo
Message      1 ──0..1 Feedback
Message(user) 1 ──n FileReference ──▶ WorkspaceDir（三空间之一 / 数据准备场景子目录）
Space        1 ──n WorkspaceDir          （数据准备为场景子目录；共享空间/临时空间仅自身）
WorkspaceDir 1 ──n UploadedDocument
WorkspaceDir 1 ──n WorkspaceFile[]
Workspace    1 ──n WorkspaceSpace（固定 3）──▶ WorkspacePanel（open / view）──▶ PreviewTarget ──▶ PreviewContent
Model 1 ──n RunState（请求级，每轮一个）
Conversation 1 ──0..1 RunState
```

## 四、验证规则汇总（可测试断言来源）

| 编号 | 规则 | 来源 |
|---|---|---|
| V-01 | 一级空间恒为 3 个、数据准备子目录与场景配置一致；三处消费同一接口下发结果，前端无目录常量 | FR-009/009a/014/031、SC-021 |
| V-02 | 单条消息引用 ≤ 10 个 | FR-017、SC-019 |
| V-03 | 上传扩展名 ∈ 目标空间的 `upload_extensions`，单文件 ≤ 50MB | FR-010 |
| V-04 | 思考内容与工具信息不出现在 `Message` 类型中 | FR-023、SC-018 |
| V-05 | `toolCalls` 展示项在 `tool_call_end` 后移除 | FR-005、SC-011 |
| V-06 | `phase === 'streaming'` ⇒ 发送按钮与数字人切换均禁用 | FR-006/036、SC-012 |
| V-07 | 仅 `completed` 且有 `id` 的消息展示操作与用量 | FR-024/025/028 |
| V-08 | 点赞与点踩互斥，同值重复提交 = 取消 | FR-027 |
| V-09 | 历史列表 10 / "更多"100 为**前端切片**，请求不含 `limit`/`offset` | FR-039/040、SC-014 |
| V-10 | 外部地址直接跳转，不进预览区 | FR-045 |
| V-11 | `.xlsx` 预览回退下载；超限与不存在给出错误提示 | FR-047/048 |
| V-12 | 错误码 → 中文文案映射完备，未知码有兜底 | FR-011/042/049、D13 |
| V-13 | 上传多选时逐文件各发一次请求，落盘名取自响应 | FR-010/011、D12 |
| V-14 | 会话进行中数字人切换入口置灰且不发请求（前端约束，后端无兜底） | FR-036 |
| V-15 | 发送前校验引用文件存在性，不存在则提示且**不发送** | FR-018 |
