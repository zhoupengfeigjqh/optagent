/**
 * 管理界面类型定义 —— 与 `contracts/admin-api.md` **一一映射**（原则七）。
 *
 * 契约是唯一事实源；本文件、后端 schema、契约文档与测试用例 MUST 四处同步。
 * 字段命名一律**下划线**，与既有接口及 `.opt-agent` 文件格式同一口径。
 */

/* ---------- 通用（§0.2 / §0.3） ---------- */

/** 卡片列表统一分页响应；`page_size` 由服务端固定为 8（4 列 × 2 行） */
export interface Paged<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

/** 非卡片长列表的有界返回 */
export interface Bounded<T> {
  items: T[]
  truncated: boolean
}

/** 后端统一错误体 */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}

/** 错误码 → 文案映射所需的错误信息（与 `frontend/src/api/types.ts` 同口径） */
export interface ErrorInfo {
  code: string
  message: string
}

/** 部署前校验的一条错误项（§6.5、§6.6） */
export interface DeployValidationError {
  user_id: string
  agent_name: string
  category: 'config_integrity' | 'reference_validity' | 'name_path_safety' | 'target_writable' | 'runtime_form'
  code: string
  message: string
  detail?: string
}

/* ---------- §1 平台与配置 ---------- */

export interface PlatformHealth {
  platform_data: { writable: boolean; path: string }
  opt_agent: { readable: boolean; writable: boolean; path: string }
  compose_file: { readable: boolean; path: string }
  docker: { available: boolean }
  runtime_form: string
}

export interface PlatformSettings {
  target_runtime_form: string
  revision: number
}

export interface RuntimeFormOption {
  value: string
  label: string
  hint?: string
}

/* ---------- §2 内置工具目录 ---------- */

export interface BuiltinTool {
  name: string
  label: string
  /** 含 `{可用目录}` / `{示例路径}` / `{会话标识}` / `{临时空间}` 占位符的模板（FR-012） */
  description_template: string
  parameters: Record<string, unknown>
  writable: boolean
}

export interface BuiltinToolListResponse {
  items: BuiltinTool[]
  total: number
  truncated: boolean
}

/* ---------- §3 MCP 服务 ---------- */

export type McpStatus = 'running' | 'stopped' | 'abnormal' | 'unknown'

export interface McpServiceListItem {
  name: string
  description: string
  transport: 'http' | 'stdio'
  status: McpStatus
  in_compose: boolean
  configured: boolean
  abnormal_reason: string | null
}

export interface McpToolInfo {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/**
 * MCP 调用确认策略（HITL 人机交互门）：
 * `never` 直跑（默认/存量行为）、`always` 全部工具调用前弹参数确认窗、
 * `{ tools: [...] }` 仅列出的原始工具名需确认
 */
export type McpConfirmation = 'never' | 'always' | { tools: string[] }

export interface ReferenceItem {
  user_id: string
  agent_name: string
}

export interface McpServiceDetail {
  name: string
  transport: 'http' | 'stdio'
  status: McpStatus
  in_compose: boolean
  description: string
  /** 按运行形态分别声明的连接地址（FR-056） */
  endpoints: Record<string, string>
  command: string | null
  args: string[] | null
  file_args: Record<string, Record<string, string>>
  /** 调用确认策略（HITL；缺省视为 never） */
  confirmation?: McpConfirmation
  tools: McpToolInfo[]
  tools_truncated: boolean
  tools_error?: string | null
  compose_declaration: Record<string, unknown> | null
  references: ReferenceItem[]
  revision: number
}

export interface McpServiceConfigPayload {
  description: string
  transport: 'http' | 'stdio'
  endpoints: Record<string, string>
  command?: string
  args?: string[]
  file_args: Record<string, Record<string, string>>
  /** 调用确认策略（HITL；缺省 never 直跑） */
  confirmation?: McpConfirmation
  revision: number
}

export interface McpServiceConfigSaved {
  name: string
  description: string
  transport: 'http' | 'stdio'
  endpoints: Record<string, string>
  writable: boolean
  permission_scope: string
  file_args: Record<string, Record<string, string>>
  revision: number
  affected_agents: string[]
}

export interface McpServiceStatusResponse {
  name: string
  status: McpStatus
}

export interface McpTestResult {
  ok: boolean
  connectivity: { ok: boolean; duration_ms: number; error_code?: string; message?: string }
  capability: { ok: boolean; method: string; duration_ms: number; error_code?: string; message?: string }
  /** 实际被测试的连接目标（界面上必须展示，避免"测的是谁"不可见） */
  target?: { transport: string; url: string | null; command: string | null }
  checked_at: string
}

export interface McpLogLine {
  ts: string | null
  line: string
}

export interface McpStatsWindow {
  ok: number
  failed: number
  total: number
}

/** 单用户调用统计（2026-09-16 十四次调整） */
export interface McpStatsUser {
  /** 调用发起用户；`null` = 升级前的历史事件未记录归属 */
  user_id: string | null
  calls_total: number
  calls_ok: number
  calls_failed: number
  last_called_at: string | null
}

export interface McpStatsItem {
  name: string
  calls_total: number
  calls_ok: number
  calls_failed: number
  last_called_at: string | null
  /** 时间窗聚合：最近24h / 7天 / 30天 / 1年（任务 2026-09-15） */
  windows?: {
    h24: McpStatsWindow
    d7: McpStatsWindow
    d30: McpStatsWindow
    d365: McpStatsWindow
  }
  /** 按用户明细（成功/失败分列）；数据来自事件明细，只覆盖最近一年 */
  users?: McpStatsUser[]
}

export interface McpStatsResponse {
  stats_available: boolean
  items: McpStatsItem[]
}

/* ---------- §4 SKILL ---------- */

export interface SkillListItem {
  name: string
  description: string
  installed_at: string
  updated_at: string
  source: string
}

export interface SkillDetail {
  name: string
  description: string
  content: string
  /** `SKILL.md` 的内容哈希：详情页直接改正文时的乐观锁基准 */
  content_hash: string
  files: Array<{ path: string; size: number }>
  source: string
  installed_at: string
  updated_at: string
  revision: number
}

/** 技能内单个文件的内容（`GET /api/admin/skills/{name}/file`） */
export interface SkillFileContent {
  name: string
  path: string
  size: number
  /** 二进制文件：`content` 为 null，界面只提示大小 */
  binary: boolean
  /** 超出上限（256KB）时为 true，`content` 只含前 256KB */
  truncated: boolean
  content: string | null
  /** 内容哈希：保存时作为乐观锁基准原样回传 */
  hash: string
  /** 是否可在线编辑：文本且完整（二进制、超 256KB 均为 false，界面不给编辑入口） */
  editable: boolean
}

/** 保存技能内单个文件的结果（`PUT /api/admin/skills/{name}/file`） */
export interface SkillFileSaved {
  name: string
  path: string
  size: number
  /** 保存后的**新**哈希：界面据此更新内部基准，可连续编辑 */
  hash: string
  updated_at: string
  revision: number
}

export interface SkillInstallResult {
  name: string
  description: string
  files: Array<{ path: string; size: number }>
  installed_at: string
  overwritten: boolean
}

/* ---------- §5 数字人设计 ---------- */

/**
 * 字段取值类型（JSON Schema 基本类型的子集）。
 *
 * 与 `admin-backend` / `agent-backend` 的同一枚举**三处同步**（契约 §5.2）。
 */
export const SCENARIO_FIELD_TYPES = [
  'string',
  'integer',
  'number',
  'boolean',
  'object',
  'array',
] as const
export type ScenarioFieldType = (typeof SCENARIO_FIELD_TYPES)[number]

/**
 * 数据准备目录的上传表字段约束。
 *
 * 校验发生在**上传时**（由运行环境按表头预检，本期未实现）；此处只声明结构。
 */
export interface ScenarioField {
  /** 字段名（＝上传表的表头名），同目录内唯一 */
  name: string
  type: ScenarioFieldType
  /** 必填：表头 MUST 包含；`false` 为可选（出现则类型仍须匹配） */
  required: boolean
}

export interface AgentScenario {
  scenario: string
  data_prep_dirs: string[]
  /** 目录 → 字段约束；无约束的目录不出现（服务端保证总有该键） */
  data_prep_fields: Record<string, ScenarioField[]>
}

export interface AgentListItem {
  name: string
  description: string
  abnormal: boolean
  abnormal_reason: string | null
  updated_at: string
}

/** 设计态完整内容（§5.3 响应） */
export interface AgentDesign {
  name: string
  soul: string
  enabled_tools: string[]
  mcp_services: string[]
  skills: string[]
  scenario: AgentScenario
  abnormal: boolean
  abnormal_reason: string | null
  updated_at: string
  revision: number
}

export interface AgentDesignPayload {
  name: string
  soul: string
  enabled_tools: string[]
  mcp_services: string[]
  skills: string[]
  scenario: AgentScenario
  revision?: number
}

/* ---------- §6 用户与部署 ---------- */

export interface UserAgentLink {
  name: string
  abnormal: boolean
  abnormal_reason: string | null
}

export interface UserSummaryEntry {
  name: string
  mcp_services: string[]
  enabled_tools: string[]
  skills: string[]
}

export interface UserListItem {
  user_id: string
  agents: UserAgentLink[]
  /** 部署状态（取自部署清单，§6.1）：`null` = 从未部署过 */
  deployed_at: string | null
  summary: UserSummaryEntry[] | null
}

export interface UserDetail {
  user_id: string
  agents: string[]
  revision: number
}

export interface DeployUserResult {
  user_id: string
  ok: boolean
  agents: Array<{ name: string; action: 'written' | 'removed'; ok: boolean }>
  error?: string
}

export interface DeployResult {
  target_runtime_form: string
  users: DeployUserResult[]
  manifest_diff: Array<Record<string, unknown>>
  history_id: string
}

export interface DeployValidateResult {
  passed: boolean
  errors: DeployValidationError[]
}

/** 部署与运行环境的差异项（契约 §6.6、`data-model.md` §7.3 的 `ManifestDiffEntry`） */
export interface DeployManifestDiffEntry {
  user_id: string
  target: string
  kind: string
  detail: string
}

/**
 * 部署历史的一条记录（契约 §6.7）。
 *
 * 除列表列用到的摘要字段外，记录里**本来就带**逐用户结果与差异项——
 * 界面「展开」后据此还原"失败的是谁、哪个数字人、为什么"，
 * 无需另设详情接口。老记录缺这些字段时按"无明细"呈现（不静默显示空白）。
 */
export interface DeployHistoryItem {
  id: string
  deployed_at: string
  operator: string
  target_runtime_form: string
  result: string
  user_count: number
  error_count: number
  /** 逐用户结果；失败原因在 `error` */
  users?: DeployUserResult[]
  validation?: { passed: boolean; error_count: number }
  manifest_diff?: DeployManifestDiffEntry[]
}

export interface ManifestEntry {
  user_id: string
  agent_names: string[]
  last_deployed_at: string
}

/* ---------- §7 派生信息 ---------- */

export interface ReferencesResponse {
  target_type: string
  target_name: string
  affected: ReferenceItem[]
}

export interface AnomalyItem {
  user_id: string
  agent_name: string
  category: 'builtin_tool' | 'mcp_service' | 'skill'
  target_name: string
  detail: string
}

export interface AnomalyResponse {
  items: AnomalyItem[]
  total: number
  truncated: boolean
  edit_path: string
}
