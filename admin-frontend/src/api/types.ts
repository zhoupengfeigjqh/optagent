

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface Bounded<T> {
  items: T[]
  truncated: boolean
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}

export interface ErrorInfo {
  code: string
  message: string
}

export interface DeployValidationError {
  user_id: string
  agent_name: string
  category: 'config_integrity' | 'reference_validity' | 'name_path_safety' | 'target_writable'
  code: string
  message: string
  detail?: string
}


export interface PlatformHealth {
  platform_data: { writable: boolean; path: string }
  opt_agent: { readable: boolean; writable: boolean; path: string }
}


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


export interface McpServiceListItem {
  name: string
  description: string
  transport: 'http' | 'stdio'
  url: string | null
  has_headers: boolean
  allowed_tools: string[]
}

export interface McpToolInfo {
  name: string
  label?: string
  description: string
  parameters: Record<string, unknown>
}

export type McpConfirmation = 'never' | 'always' | { tools: string[] }

export interface ReferenceItem {
  user_id: string
  agent_name: string
}

export interface McpServiceDetail {
  name: string
  transport: 'http' | 'stdio'
  description: string
  url: string | null
  command: string | null
  args: string[] | null
  file_args: Record<string, Record<string, string>>
  confirmation?: McpConfirmation
  rules_fields?: Record<string, string>
  allowed_tools: string[]
  tool_labels?: Record<string, string>
  /**
   * 白名单里**当前服务清单中已不存在**的工具名（下架/改名）——界面据此标异常。
   * **只在探测成功时才有意义**：服务不可达时恒为 `[]`（"核对不了"由 `tools_error` 表达）。
   */
  missing_tools: string[]
  /** **请求头（值已掩码）**（2026-10-08）：空对象 = 未配置。掩码仅供展示，MUST NOT 提交回去（保存期会拒） */
  headers: Record<string, string>
  tools: McpToolInfo[]
  tools_truncated: boolean
  /**
   * **本次探测到的全部工具**（2026-10-15）：工具范围弹窗的勾选基准。
   *
   * `tools` 是白名单投影，拿它当基准就永远加不进一个当前不在白名单里的工具。
   * **探测失败（`tools_error` 非空）时为空数组**——此时 MUST NOT 开弹窗，
   * 因为拿不到可信清单，勾选等于凭空造范围。
   */
  available_tools: McpToolInfo[]
  available_tools_truncated: boolean
  tools_error?: string | null
  references: ReferenceItem[]
  revision: number
}

export interface McpServiceBasics {
  description: string
  transport: 'http' | 'stdio'
  url?: string
  command?: string
  args?: string[]
  headers?: Record<string, string>
}

export interface McpServiceConfigPayload extends McpServiceBasics {
  file_args: Record<string, Record<string, string>>
  confirmation?: McpConfirmation
  rules_fields?: Record<string, string>
  allowed_tools?: string[]
  tool_labels?: Record<string, string>
  revision: number
}

export type McpServiceConfigInput = Omit<McpServiceConfigPayload, 'revision'>

export interface McpServiceCreatePayload extends McpServiceBasics {
  name: string
  allowed_tools: string[]
  revision?: number
}

export interface McpProbeResult {
  ok: boolean
  tools: McpToolInfo[]
  tools_truncated: boolean
  error: string | null
  error_code: string | null
  /** 实际探测目标——界面上 MUST 展示，否则"测的是谁"不可见 */
  target: { transport: 'http' | 'stdio'; url: string | null; command: string | null }
  checked_at: string
}

export interface McpServiceConfigSaved {
  name: string
  description: string
  transport: 'http' | 'stdio'
  url: string | null
  command: string | null
  args: string[] | null
  file_args: Record<string, Record<string, string>>
  rules_fields: Record<string, string>
  confirmation: McpConfirmation
  allowed_tools: string[]
  headers: Record<string, string>
  updated_at: string
  revision: number
  affected_agents: string[]
}

export interface McpTestResult {
  ok: boolean
  connectivity: { ok: boolean; duration_ms: number; error_code?: string; message?: string }
  capability: {
    ok: boolean
    method: string
    duration_ms: number
    error_code?: string
    message?: string
  }
  /** 实际被测试的连接目标（界面上必须展示，避免"测的是谁"不可见） */
  target?: { transport: string; url: string | null; command: string | null }
  checked_at: string
}

export interface McpStatsWindow {
  ok: number
  failed: number
  total: number
}

export interface McpStatsItem {
  name: string
  calls_total: number
  calls_ok: number
  calls_failed: number
  last_called_at: string | null
}

export interface McpStatsGroup {
  service: string
  tool_name: string | null
  user_id: string | null
  calls_total: number
  calls_ok: number
  calls_failed: number
  last_called_at: string | null
  windows?: {
    h24: McpStatsWindow
    d7: McpStatsWindow
    d30: McpStatsWindow
    d365: McpStatsWindow
  }
}

export interface McpStatsResponse {
  stats_available: boolean
  items: McpStatsItem[]
  groups: McpStatsGroup[]
}


export type {
  SkillDetail,
  SkillFileContent,
  SkillFileSaved,
  SkillInstallResult,
  SkillListItem,
} from './skill-types'


export {
  SCENARIO_FIELD_TYPES,
  type AgentDesign,
  type AgentDesignPayload,
  type AgentListItem,
  type AgentScenario,
  type ScenarioField,
  type ScenarioFieldType,
  type SoulDesign,
  type SoulStarter,
  type SoulStarterTool,
} from './agent-types'


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
  users: DeployUserResult[]
  manifest_diff: Array<Record<string, unknown>>
  history_id: string
}

export interface DeployValidateResult {
  passed: boolean
  errors: DeployValidationError[]
}

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
  result: string
  user_count: number
  error_count: number
  users?: DeployUserResult[]
  validation?: { passed: boolean; error_count: number }
  manifest_diff?: DeployManifestDiffEntry[]
}

export interface ManifestEntry {
  user_id: string
  agent_names: string[]
  last_deployed_at: string
}


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
