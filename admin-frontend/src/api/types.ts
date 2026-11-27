

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
  type AgentDeletionImpact,
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

export interface UserListItem {
  user_id: string
  agents: UserAgentLink[]
  deployed_at: string | null
  /**
   * 028 §13：账号扩展字段。标记可选以兼容旧响应/测试夹具——
   * 组件侧一律 `?? null` / `?.` 兜底，后端（028 起）恒返回。
   */
  phone?: string | null
  display_name?: string | null
  role?: 'admin' | 'user'
  source_agent_code?: string | null
  /**
   * 授权 = 关联（2026-11-27 收敛）：`agents[]` 既是"已授权的数字人"也是"要部署的数字人"，
   * 授权数就是 `agents.length`。`expand=summary` 及其 `summary` 字段同日移除（无消费方）。
   */
}

/**
 * 单用户部署结果（契约 §6.5）。
 *
 * 只保留界面用得到的两个判据：整批 `ok` 与失败原因；差异明细（`manifest_diff`）
 * 随部署功能区一并下架，不再展示。
 */
export interface DeployUserResult {
  user_id: string
  ok: boolean
  agents: Array<{ name: string; action: 'written' | 'removed'; ok: boolean }>
  error?: string
}

export interface DeployResult {
  users: DeployUserResult[]
  history_id: string
}

/** 撤回结果（契约 §6.9）：`withdrawn` 是运行环境里实际被移除的数字人目录名 */
export interface WithdrawResult {
  user_id: string
  withdrawn: string[]
}

export interface UserDetail {
  user_id: string
  agents: string[]
  revision: number
  /** 028 §13：账号扩展字段 */
  phone?: string | null
  display_name?: string | null
  role?: 'admin' | 'user'
  source_agent_code?: string | null
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

/* ---------- §13 账号与数字人服务绑定（028）---------- */

/**
 * §13 相关类型**定义在 `./account-types.ts`**，本文件再导出（同 skill-types /
 * agent-types 拆件先例，原则二）。既有引用方一律从 `api/types` 取。
 */
export type {
  AgentServiceCreatePayload,
  AgentServiceItem,
  AgentServiceUpdatePayload,
  MeProfile,
  MyAgents,
  RegisterLinkCreated,
  RegisterLinkItem,
  RegisterLinkLookup,
  RegisterResult,
} from './account-types'
