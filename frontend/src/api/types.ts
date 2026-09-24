/**
 * 后端契约类型
 *
 * 与 `specs/001-agent-chat-ui/contracts/backend-api.md` 一一对应，字段名与后端 JSON 保持一致
 * （下划线命名，不做法语化重命名，降低契约映射成本）。
 *
 * ⚠️ `Message` 仍**不含思考内容**——思考只在 SSE 流中存在、不落历史（V-04、FR-023、SC-018）。
 *
 * 工具调用记录（002 特性）与之不同：它随消息经 `tool_calls` 下发（元数据 + 内联小结果），
 * 超阈值的结果正文存于临时空间，由 `/api/threads/{id}/tool-calls/{call_id}` 按需拉取；
 * 记录的生命周期与会话一致，**刷新后仍可见**。
 */

/* ============================================================
 * 通用
 * ============================================================ */

/** 后端统一错误体：`{ error: { code, message, details? } }`。 */
export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

/** 前端展示用错误信息（错误码 + 后端原始文案，文案仅作兜底）。 */
export interface ErrorInfo {
  code: string
  message: string
  /** 后端结构化问题清单（仅 `FILE_SCHEMA_INVALID` 使用；D13 例外，透传展示） */
  details?: unknown
}

/* ============================================================
 * §1 数字人与 MCP
 * ============================================================ */

/** `GET /api/agents` 元素：顶层数组。 */
export interface AgentListItem {
  agent_name: string
  description: string
}

/** 数字人技能。 */
export interface AgentSkill {
  name: string
  description: string
}

/** 数字人挂载的 MCP 服务（**不含** url/command 等连接细节）。 */
export interface McpServerRef {
  name: string
  transport: string
}

/** `GET /api/agents/{agent_name}` 响应。 */
export interface DigitalHuman {
  agent_name: string
  /** SOUL.md 全文，界面展示为"描述" */
  soul: string
  skills: AgentSkill[]
  enabled_tools: string[]
  mcp_servers: McpServerRef[]
}

/**
 * MCP 连接状态：`connected` → 绿；`failed` → 红；`unknown` → 灰。
 *
 * `unknown` 表示**尚无连接结果**（实例未创建，或首次建连进行中），
 * 属正常观测态，MUST NOT 渲染为故障（FR-033、FR-034）。
 */
export type McpConnectionStatus = 'connected' | 'failed' | 'unknown'

/** `GET /api/agents/current/mcp` 元素。 */
export interface McpServiceStatus {
  name: string
  transport: string
  status: McpConnectionStatus
}

/** `GET /api/agents/current` 响应。 */
export interface CurrentAgentResponse {
  agent_name: string | null
}

/** `GET /api/agents/current/mcp` 响应。 */
export interface CurrentMcpResponse {
  agent_name: string | null
  mcp_servers: McpServiceStatus[]
}

/** `POST /api/agents/{agent_name}/select` 响应。 */
export interface SelectAgentResponse {
  agent_name: string
  selected: boolean
}

/** `POST /api/agents/current/exit` 响应。 */
export interface ExitAgentResponse {
  exited: boolean
}

/* ============================================================
 * §2 模型
 * ============================================================ */

/** `GET /api/models` 元素。 */
export interface Model {
  model: string
  is_default: boolean
}

/** `GET /api/models` 响应。 */
export interface ModelListResponse {
  models: Model[]
}

/* ============================================================
 * §3 会话
 * ============================================================ */

/** 用量。 */
export interface Usage {
  input_tokens: number
  output_tokens: number
}

/** 反馈取值：点赞 / 点踩 / 无。 */
export type FeedbackValue = 'up' | 'down' | null

/** 文件引用（结构化 `{dir, filename}`，非字符串数组）。 */
export interface FileReference {
  dir: string
  filename: string
}

/** 消息角色。 */
export type MessageRole = 'user' | 'assistant'

/** 消息状态：仅 assistant 完成轮返回，缺省视为 `completed`。 */
export type MessageStatus = 'completed' | 'failed'

/**
 * 一次工具调用的记录（002 特性）。
 *
 * - 元数据（`name` / `status` / `duration_ms` / `size`）恒有；`status==='running'`
 *   表示该调用没有留下结束事件（进程中途退出），界面渲染为"未完成"
 * - `content` 有值 = 结果正文已内联下发（小结果）
 * - `artifact_size` 有值 = 正文在临时空间，需拉 `ToolCallResult` 才可见；
 *   正文可能已被清理（此时接口返回 410，卡片降级为"内容已过期"）
 * - `args_digest` 是**入参短标量摘要**：入参原文不落盘、不下发
 */
export interface ToolCallRecord {
  call_id: string
  name: string
  status: 'running' | 'success' | 'error'
  /** ISO8601 */
  started_at: string
  duration_ms?: number
  /** 结果字节数 */
  size?: number
  /** 内联结果正文（小结果随详情一起下发） */
  content?: string
  /** 外置正文的字节数（有值即需按需拉取） */
  artifact_size?: number
  /** 结果被单条落盘上限截断 */
  truncated?: boolean
  /** 规则提取的摘要（外置结果的卡片标题） */
  summary?: string
  /** 入参短标量摘要 */
  args_digest?: Record<string, string>
}

/** `GET /api/threads/{id}/tool-calls/{call_id}` 响应（外置正文全文）。 */
export interface ToolCallResult {
  call_id: string
  name: string
  status: 'running' | 'success' | 'error'
  size: number
  content: string
  truncated?: boolean
}

/**
 * 会话消息。
 *
 * 注意：**不含**思考内容（V-04、SC-018）；工具调用记录经 `tool_calls` 下发。
 */
export interface Message {
  /** 消息标识（反馈接口使用；旧数据由服务端合成） */
  id: string
  role: MessageRole
  /** 正文（不含 `@` 引用标注文本） */
  content: string
  /** ISO8601 */
  ts: string
  /** 仅 assistant 有；缺省视为 `completed` */
  status?: MessageStatus
  /** 仅 assistant 完成/失败轮 */
  usage?: Usage
  /** 整轮耗时（秒）；后端精度不固定（最多 3 位小数），前端统一格式化 1 位小数 */
  duration_seconds?: number
  /** 仅带 `@` 引用的 user 消息 */
  attachments?: FileReference[]
  /**
   * 本轮对话使用的数字人（user 与 assistant 成对返回）。
   * 一个会话可跨多个数字人（切换后在下一轮生效）；旧数据可能缺省。
   */
  agent_name?: string
  /** 本轮的工具调用记录（仅该轮确有调用时返回；旧数据无） */
  tool_calls?: ToolCallRecord[]
  /** 恒返回，默认 `null` */
  feedback: FeedbackValue
  /** 仅 `status === 'failed'` */
  error?: ErrorInfo
}

/** `GET /api/threads` 元素与 `POST /api/threads` 的列表视图。 */
export interface Conversation {
  thread_id: string
  agent_name: string
  /** 后端回落为"首条用户消息前 20 字"；从未发过用户消息时为 `null` */
  title: string | null
  created_at: string
  updated_at: string
}

/** `GET /api/threads/{thread_id}` 响应。 */
export interface ThreadDetail extends Conversation {
  /** 消息全量条数 */
  total: number
  /** 按时间正序 */
  messages: Message[]
  /** 该会话当前是否有活跃 run */
  running: boolean
  /** HITL：当前等待用户确认的工具调用快照（无则 `null`，断连恢复弹窗用） */
  pending_interaction: InteractionSnapshot | null
}

/** `POST /api/threads` 响应（**不返回** `agent_name` 与 `updated_at`）。 */
export interface ThreadCreateResponse {
  thread_id: string
  title: string | null
  created_at: string
}

/** `PUT /api/threads/{thread_id}/messages/{message_id}/feedback` 响应。 */
export interface FeedbackResponse {
  message_id: string
  feedback: FeedbackValue
}

/** `POST /api/threads/{thread_id}/stop` 响应。 */
export interface StopResponse {
  stopped: boolean
}

/* ============================================================
 * §4 发消息（SSE 流式）
 * ============================================================ */

/** `POST /api/threads/{thread_id}/messages` 请求体（`additionalProperties: false`）。 */
export interface SendMessageRequest {
  /** 去掉 `@文件名` 引用文本后的正文（minLength: 1） */
  content: string
  /** 思考开关状态；后端缺省 `false` */
  thinking?: boolean
  /** 当前选中模型；未选择时**不传该字段** */
  model?: string
  /** 结构化引用（maxItems: 10） */
  attachments?: FileReference[]
}

/** `done.finish_reason`：`completed` 正常落盘；`stop` 本轮被中断丢弃、不落盘。 */
export type StreamFinishReason = 'completed' | 'stop'

/** `thinking` 事件数据。 */
export interface ThinkingEventData {
  delta: string
}

/** `content` 事件数据。 */
export interface ContentEventData {
  delta: string
}

/** `tool_call` 事件数据（**仅名称**，无入参与结果）。 */
export interface ToolCallEventData {
  call_id: string
  name: string
  status: 'running'
}

/** `tool_call_end` 事件数据。 */
export interface ToolCallEndEventData {
  call_id: string
  status: 'success' | 'error'
}

/** `done` 事件数据。 */
export interface DoneEventData {
  finish_reason: StreamFinishReason
  usage: Usage
  duration_seconds: number
  /** 中断轮为 `null` */
  message_id: string | null
  /** 本轮回答的数字人（会话可跨数字人） */
  agent_name: string
}

/** `error` 事件数据（`duration_seconds` / `usage` 可选）。 */
export interface StreamErrorEventData {
  error: ErrorInfo
  duration_seconds?: number
  usage?: Usage
  /** 本轮回答的数字人（会话可跨数字人） */
  agent_name: string
}

/**
 * `interaction_request` 事件数据（HITL）：工具调用前的人工确认。
 * schema 为工具入参 JSON Schema（可见形态），proposed_args 为模型提议值（预填可改）。
 */
export interface InteractionRequestData {
  interaction_id: string
  call_id: string
  tool_name: string
  /** 工具级描述（schema 的 description；弹窗头部一句话说明用；老快照可能缺省） */
  tool_description?: string
  title: string
  schema: Record<string, unknown>
  proposed_args: Record<string, unknown>
  required: string[]
  timeout_seconds: number
  /** 算法规则参数字段名（仅服务声明且工具 schema 含该字段时存在）：该字段装配「从算法规则选择」入口 */
  rules_field?: string
}

/** `GET /api/files/rules` 响应：「数据准备/算法规则」最新规则文件的结构化内容。 */
export interface RuleFileResponse {
  filename: string
  updated_at: string
  /** 表头列名（保持文件内顺序） */
  columns: string[]
  /** 数据行：键 = 表头列名，值 = 该行该列的值 */
  rows: Array<Record<string, unknown>>
  /** 优先级列名（表头里匹配 priority/优先级 的那一列；无则 null） */
  priority_column: string | null
}

/** 断连恢复快照：interaction_request + 剩余等待秒数（线程详情接口下发）。 */
export interface InteractionSnapshot extends InteractionRequestData {
  remaining_seconds: number
}

/** `POST /api/threads/{id}/interaction` 请求体。 */
export interface InteractionSubmitRequest {
  interaction_id: string
  action: 'submit' | 'reject'
  /** action=submit 必填（服务端按挂起时的 inputSchema 终验） */
  args?: Record<string, unknown>
}

/** `POST /api/threads/{id}/interaction` 响应（202；重复提交幂等返回首次结果）。 */
export interface InteractionSubmitResponse {
  accepted: boolean
  result: 'settled' | 'already-resolved'
}

/** SSE 事件 → 类型化载荷的联合类型（仅本轮可见，不落历史）。 */
export type StreamEvent =
  | { type: 'thinking'; data: ThinkingEventData }
  | { type: 'content'; data: ContentEventData }
  | { type: 'tool_call'; data: ToolCallEventData }
  | { type: 'tool_call_end'; data: ToolCallEndEventData }
  | { type: 'interaction_request'; data: InteractionRequestData }
  | { type: 'done'; data: DoneEventData }
  | { type: 'error'; data: StreamErrorEventData }

/** SSE 解析器输出的原始事件（未类型化）。 */
export interface RawSseEvent {
  event: string
  data: string
}

/* ============================================================
 * §5 文件
 * ============================================================ */

/** `POST /api/files/upload` 响应（`filename` 为落盘名，前端 MUST 直接采用）。 */
export interface UploadResponse {
  dir: string
  filename: string
  size: number
}

/** 工作空间/目录列表中的文件项。 */
export interface WorkspaceFile {
  filename: string
  size: number
  updated_at: string
}

/**
 * 数据准备目录的字段约束（`scenario.json` 的 `data_prep_fields` 随 workspace 接口下发）。
 *
 * 前端**只展示**（上传入口的表头要求提示）；权威校验在上传路由执行，
 * 前端 MUST NOT 自行判定（契约 `runtime-api-delta.md` §3.1）。
 */
export interface ScenarioField {
  /** 字段名（＝上传表的表头名） */
  name: string
  /** 取值类型（JSON Schema 基本类型子集） */
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array'
  /** 必填：表头 MUST 包含；`false` 为可选（出现则类型仍须匹配） */
  required: boolean
}

/** 工作空间目录分组（dir 为相对空间路径，如 数据准备/生产计划、共享空间）。 */
export interface WorkspaceDir {
  dir: string
  /** 展示名（数据准备子目录为子目录名，其余为空间名） */
  label: string
  /** 用户是否可删除其中文件（共享空间只读为 false） */
  deletable: boolean
  /** 空目录为 `[]` */
  files: WorkspaceFile[]
  /** 字段约束（仅数据准备目录可能有值，其余空间恒为 `[]`） */
  fields: ScenarioField[]
}

/** 工作空间空间分组（一级：数据准备/共享空间/临时空间）。 */
export interface WorkspaceSpace {
  /** 空间名（即一级目录名） */
  name: string
  /** Agent 是否可写（仅临时空间） */
  agent_writable: boolean
  /** 该空间允许上传的扩展名（小写含点） */
  upload_extensions: string[]
  /** 数据准备为 scenario 定义的子目录清单，其余空间仅自身一项 */
  dirs: WorkspaceDir[]
}

/** `GET /api/files/workspace` 响应（三空间树；scenario 未配置 → 503）。 */
export interface WorkspaceResponse {
  /** 场景名（users/{userId}/scenario.json 定义） */
  scenario: string
  spaces: WorkspaceSpace[]
}
