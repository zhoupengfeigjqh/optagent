
import type { ThreadNextSteps } from './threads'


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
  details?: unknown
  reason?: string
  upstream_status?: number
  upstream_type?: string
  request_id?: string
}


export interface AgentListItem {
  agent_name: string
  description: string
}

export interface AgentSkill {
  name: string
  description: string
}

export interface McpServerRef {
  name: string
  transport: string
}

export interface AgentStarterTool {
  kind: 'builtin' | 'mcp'
  name: string
  service?: string
  exposed_name: string
}

export interface AgentStarter {
  prompt: string
  tools: AgentStarterTool[]
  /**
   * 隐藏工具引导：发送时随请求回传，**对用户不可见**。
   *
   * 两类来源口径不同：首屏问题实例（004）可为空串（无关联工具）；
   * **下一步动作卡片必然关联 ≥1 个可用工具，引导恒非空**（007 修订 2026-10-14）。
   */
  guidance: string
}

export interface ToolTip {
  name: string
  title: string
  ontology_id: string
  ontology_name: string | null
}

export interface NextStepAction {
  prompt: string
  tool_tips: ToolTip[]
}

export interface DigitalHuman {
  agent_name: string
  intro: string
  welcome: string
  starters: AgentStarter[]
  /** SOUL.md 全文（兼容保留；展示语义已由 `intro` 承担） */
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

export interface McpServiceStatus {
  name: string
  transport: string
  status: McpConnectionStatus
}

export interface CurrentAgentResponse {
  agent_name: string | null
}

export interface CurrentMcpResponse {
  agent_name: string | null
  mcp_servers: McpServiceStatus[]
}

export interface AgentSkill {
  name: string
  description: string
}

export interface CurrentSkillsResponse {
  agent_name: string
  skills: AgentSkill[]
}

export interface SelectAgentResponse {
  agent_name: string
  selected: boolean
}

export interface ExitAgentResponse {
  exited: boolean
}


export interface Model {
  model: string
  is_default: boolean
}

export interface ModelListResponse {
  models: Model[]
}


export interface Usage {
  input_tokens: number
  output_tokens: number
}

export type FeedbackValue = 'up' | 'down' | null

export interface FileReference {
  dir: string
  filename: string
}

export type MessageRole = 'user' | 'assistant'

export type MessageStatus = 'completed' | 'failed'

export interface ViewLink {
  url: string
  name?: string
  kind?: 'url' | 'file'
}

export interface ToolCallRecord {
  call_id: string
  name: string
  label?: string
  status: 'running' | 'success' | 'error'
  started_at: string
  duration_ms?: number
  size?: number
  content?: string
  artifact_size?: number
  /** 记录正文被截断（只保存了一部分）；`size > artifact_size` 表示副本本身也被上限截断 */
  truncated?: boolean
  summary?: string
  args_digest?: Record<string, string>
  view_links?: ViewLink[]
}

/**
 * 会话消息。
 *
 * 注意：**不含**思考内容（V-04、SC-018）；工具调用记录经 `tool_calls` 下发。
 */
export interface Message {
  id: string
  role: MessageRole
  content: string
  ts: string
  status?: MessageStatus
  usage?: Usage
  duration_seconds?: number
  attachments?: FileReference[]
  skill?: string
  agent_name?: string
  tool_calls?: ToolCallRecord[]
  feedback: FeedbackValue
  error?: ErrorInfo
}

export interface ThreadSource {
  type: 'scheduled_task'
  task_id: string
  task_name: string
  triggered_at: string
}

export interface Conversation {
  thread_id: string
  agent_name: string
  title: string | null
  created_at: string
  updated_at: string
  source?: ThreadSource
}

export interface ThreadDetail extends Conversation {
  total: number
  messages: Message[]
  running: boolean
  pending_interaction: InteractionSnapshot | null
}

export interface ThreadCreateResponse {
  thread_id: string
  title: string | null
  created_at: string
}

export interface FeedbackResponse {
  message_id: string
  feedback: FeedbackValue
}

export interface StopResponse {
  stopped: boolean
}


export interface SendMessageRequest {
  content: string
  thinking?: boolean
  model?: string
  attachments?: FileReference[]
  guidance?: string
  tool_tips?: ToolTip[]
  skip_intent_focus?: boolean
  skill?: string
}

export type StreamFinishReason = 'completed' | 'stop'

export interface ThinkingEventData {
  delta: string
}

export interface ContentEventData {
  delta: string
}

export interface ToolCallEventData {
  call_id: string
  name: string
  label?: string
  status: 'running'
}

export interface ToolCallEndEventData {
  call_id: string
  status: 'success' | 'error'
}

/**
 * 计划进度（028 FR-034）：单行进度条的唯一数据源。
 *
 * 只带当前步的编号 / 步名 / 三态；不是完整计划，也不持久化。
 */
export interface PlanProgressEventData {
  seq_id: number
  label: string
  phase: 'running' | 'replanned' | 'done'
}

export interface DoneEventData {
  finish_reason: StreamFinishReason
  usage: Usage
  duration_seconds: number
  message_id: string | null
  /** 本轮回答的数字人（009 起会话归属固定：数字人不可在会话中途变更；逐条标注保留以兼容存量数据） */
  agent_name: string
  next_actions?: ThreadNextSteps | null
}

export interface StreamErrorEventData {
  error: ErrorInfo
  duration_seconds?: number
  usage?: Usage
  /** 本轮回答的数字人（009 起会话归属固定：数字人不可在会话中途变更；逐条标注保留以兼容存量数据） */
  agent_name: string
}

export interface InteractionRequestData {
  interaction_id: string
  call_id: string
  tool_name: string
  tool_label?: string
  tool_description?: string
  title: string
  schema: Record<string, unknown>
  proposed_args: Record<string, unknown>
  required: string[]
  timeout_seconds: number
  rules_field?: string
}

export interface RuleFileResponse {
  filename: string
  updated_at: string
  columns: string[]
  rows: Array<Record<string, unknown>>
  priority_column: string | null
}

export interface InteractionSnapshot extends InteractionRequestData {
  remaining_seconds: number
}

export interface InteractionSubmitRequest {
  interaction_id: string
  action: 'submit' | 'reject'
  args?: Record<string, unknown>
}

/** `POST /api/threads/{id}/interaction` 响应（202；重复提交幂等返回首次结果）。 */
export interface InteractionSubmitResponse {
  accepted: boolean
  result: 'settled' | 'already-resolved'
}

export type StreamEvent =
  | { type: 'thinking'; data: ThinkingEventData }
  | { type: 'content'; data: ContentEventData }
  | { type: 'tool_call'; data: ToolCallEventData }
  | { type: 'tool_call_end'; data: ToolCallEndEventData }
  | { type: 'plan_progress'; data: PlanProgressEventData }
  | { type: 'interaction_request'; data: InteractionRequestData }
  | { type: 'done'; data: DoneEventData }
  | { type: 'error'; data: StreamErrorEventData }

export interface RawSseEvent {
  event: string
  data: string
}


export interface UploadResponse {
  dir: string
  filename: string
  size: number
}

export interface WorkspaceFile {
  filename: string
  size: number
  updated_at: string
}

export interface PreviewMerge {
  r: number
  c: number
  rowSpan: number
  colSpan: number
}

export interface PreviewSheet {
  name: string
  rows: string[][]
  numericCols: number[]
  merges: PreviewMerge[]
  /** 是否因服务端行/列上限被截断（完整内容请下载） */
  truncated: boolean
}

export interface PreviewWorkbook {
  sheets: PreviewSheet[]
}

/**
 * 数据准备目录的字段约束（`scenario.json` 的 `data_prep_fields` 随 workspace 接口下发）。
 *
 * 前端**只展示**（上传入口的表头要求提示）；权威校验在上传路由执行，
 * 前端 MUST NOT 自行判定（契约 `runtime-api-delta.md` §3.1）。
 */
export interface ScenarioField {
  name: string
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array'
  required: boolean
}

/** 工作空间目录分组（dir 为相对空间路径，如 数据准备/生产计划、临时空间）。 */
export interface WorkspaceDir {
  dir: string
  label: string
  deletable: boolean
  files: WorkspaceFile[]
  fields: ScenarioField[]
  upload_extensions: string[]
  predefined: boolean
}

/** 工作空间空间分组（一级：数据准备/临时空间）。 */
export interface WorkspaceSpace {
  name: string
  /** Agent 是否可写（仅临时空间） */
  agent_writable: boolean
  upload_extensions: string[]
  dirs: WorkspaceDir[]
}

export interface WorkspaceResponse {
  scenario: string
  spaces: WorkspaceSpace[]
}


/** 任务状态（派生字段，服务端现算；前端 MUST NOT 自行推导）。 */
export type ScheduledTaskStatus = 'idle' | 'running'

export type ScheduledTaskDisabledReason = 'agent_unavailable'

export interface ScheduledTask {
  task_id: string
  name: string
  prompt: string
  thinking: boolean
  start_at: string
  interval_seconds: number
  /** 执行次数上限（≥1） */
  max_runs: number
  deadline_at: string
  /** `true` = 每轮新建会话（缺省）；`false` = 复用同一会话（创建后不可改） */
  new_thread_per_run: boolean
  enabled: boolean
  executed_count: number
  status: ScheduledTaskStatus
  terminated: boolean
  can_start: boolean
  disabled_reason: ScheduledTaskDisabledReason | null
  next_run_at: string | null
  last_run_at: string | null
  agent_name: string
  created_at: string
  updated_at: string
}

export interface ScheduledTaskListResponse {
  tasks: ScheduledTask[]
}

export interface CreateScheduledTaskRequest {
  name: string
  prompt: string
  thinking?: boolean
  start_at: string
  interval_seconds: number
  max_runs: number
  deadline_at: string
  new_thread_per_run?: boolean
}

/**
 * `PATCH /api/scheduled-tasks/{task_id}` 请求体（编辑，2026-10-30 增补）。
 *
 * 整份替换 7 项可编辑字段；刻意不含 `new_thread_per_run`——会话模式创建后不可改
 * （`FR-060`），服务端按"未声明字段"直接 400。
 */
export type UpdateScheduledTaskRequest = Omit<CreateScheduledTaskRequest, 'new_thread_per_run'>

export interface ScheduledTaskResponse {
  task: ScheduledTask
}

export type ScheduleRunResult = 'success' | 'failed' | 'skipped'

export type ScheduleRunReason =
  'previous_run_active' | 'busy_limit' | 'agent_unavailable' | 'run_failed'

export interface ScheduleRun {
  run_id: string
  task_id: string
  task_name: string
  triggered_at: string
  finished_at: string | null
  result: ScheduleRunResult
  reason: ScheduleRunReason | null
  reason_text: string | null
  thread_id: string | null
  thread_title: string | null
  rebuilt: boolean
  /** 读取时回填：会话已不存在（不可跳转） */
  thread_deleted: boolean
}

export interface ScheduleRunListResponse {
  runs: ScheduleRun[]
  total: number
}
