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

/**
 * 部署前校验的一条错误项（§6.5、§6.6）。
 *
 * **2026-09-27**：`runtime_form` 类别随运行形态概念下架。
 */
export interface DeployValidationError {
  user_id: string
  agent_name: string
  category: 'config_integrity' | 'reference_validity' | 'name_path_safety' | 'target_writable'
  code: string
  message: string
  detail?: string
}

/* ---------- §1 平台健康 ---------- */

/**
 * 平台健康检查（§1.1）。
 *
 * **2026-09-27**：`compose_file` / `docker` / `runtime_form` 三个字段随
 * 「MCP 服务全人工配置」下架——平台不再读容器编排声明与容器运行态。
 */
export interface PlatformHealth {
  platform_data: { writable: boolean; path: string }
  opt_agent: { readable: boolean; writable: boolean; path: string }
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

/**
 * 卡片列表项（§3.1）。
 *
 * **2026-09-27**：MCP 服务改为平台内全人工新建/维护，故卡片只呈现
 * **配置事实**（名称 / 用途 / 传输方式 / 连接地址），不再有容器状态
 * （`status`）、编排来源（`in_compose`）与配置态（`configured`）。
 */
export interface McpServiceListItem {
  name: string
  description: string
  transport: 'http' | 'stdio'
  /** 连接地址（`http` 服务必有；`stdio` 为 null） */
  url: string | null
  /** 是否配置了请求头（2026-10-08；卡片徽标用）。**只给布尔量**：请求头里是凭据，值一律不下发 */
  has_headers: boolean
  /** 工具白名单（2026-10-09）：数字人问题实例的「关联工具」可选项来源 */
  allowed_tools: string[]
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
  description: string
  /** 连接地址（`http` 服务必有；`stdio` 为 null） */
  url: string | null
  command: string | null
  args: string[] | null
  file_args: Record<string, Record<string, string>>
  /** 调用确认策略（HITL；缺省视为 never） */
  confirmation?: McpConfirmation
  /** 算法规则参数设置（缺省/空对象 = 不启用「从算法规则选择」入口） */
  rules_fields?: Record<string, string>
  /**
   * 异步工具声明（R11，2026-09-25）：该服务**原始工具名**清单（不含 `{server}__` 前缀）。
   * 声明后运行环境为这些工具注入结果回写地址，服务算完把结果写到用户空间，
   * 并在下一轮对话注入「后台计算结果」清单。缺省/空数组 = 不启用。
   */
  async_tools?: string[]
  /**
   * **工具白名单**（2026-10-03；2026-10-15 起可调整）：该服务可见的原始工具名清单。
   * 空数组 = 不限制（白名单上线前的存量服务）；新建时必填非空，
   * 之后可在「工具范围」弹窗里调整（保存走 `PUT`，全量替换、同样必填非空）。
   */
  allowed_tools: string[]
  /**
   * 白名单里**当前服务清单中已不存在**的工具名（下架/改名）——界面据此标异常。
   * **只在探测成功时才有意义**：服务不可达时恒为 `[]`（"核对不了"由 `tools_error` 表达）。
   */
  missing_tools: string[]
  /** **请求头（值已掩码）**（2026-10-08）：空对象 = 未配置。掩码仅供展示，MUST NOT 提交回去（保存期会拒） */
  headers: Record<string, string>
  /** 只含白名单里的工具（顺序与白名单一致）；不限制时即服务全量 */
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

/**
 * 调用配置的**基础连接字段**（弹窗新建与详情页表单共用；2026-09-27）。
 *
 * 后端 `normalize()` 会为未提供者补默认（`file_args: {}`、`confirmation: 'never'`、
 * `rules_fields: {}`、`async_tools: []`），故新建只 MUST 提供基础字段。
 */
export interface McpServiceBasics {
  description: string
  transport: 'http' | 'stdio'
  /** 连接地址（`transport=http` 时必填） */
  url?: string
  command?: string
  args?: string[]
  /** **请求头**（2026-10-08；真实值，仅 `http`）：缺省 = 沿用存量，提供 = 全量替换（`{}` 清空） */
  headers?: Record<string, string>
}

/** `PUT /api/admin/mcp/services/{name}` 的载荷（契约 §3.3）；`revision` 为乐观锁版本 */
export interface McpServiceConfigPayload extends McpServiceBasics {
  file_args: Record<string, Record<string, string>>
  /** 调用确认策略（HITL；缺省 never 直跑） */
  confirmation?: McpConfirmation
  /** 算法规则参数设置（空对象 = 不启用） */
  rules_fields?: Record<string, string>
  /** 异步工具声明（R11；空数组 = 不启用；物化时非空才写入 `MCP.json`） */
  async_tools?: string[]
  /**
   * 工具白名单（**2026-10-15 起可在此调整**）：缺省 = 沿用存量，提供 = **全量替换**
   * 且必须非空（空数组 = 不限制，与"一个都不给"语义相反，服务端会 400）。
   *
   * 载荷仍是**全量替换**语义：只改白名单时其余字段 MUST 一并回填
   * （见 `utils/mcp-config.ts` 的 `buildToolScopePayload`），否则会被补成默认值。
   */
  allowed_tools?: string[]
  revision: number
}

/** 表单提交的调用配置：`revision` 由详情页按当前详情补上（乐观锁在调用处决定） */
export type McpServiceConfigInput = Omit<McpServiceConfigPayload, 'revision'>

/**
 * `POST /api/admin/mcp/services` 的新建载荷（契约 §3.3.1，2026-09-27；2026-10-03 起含白名单）。
 *
 * 与保存载荷的差别有三点：**名称由管理员指定**（且全局唯一）、
 * **`allowed_tools` 必填非空**（服务端还会先连一次服务，连不上即创建失败且不落盘）、
 * 其余调用配置依赖工具清单，创建后到详情页补全；`revision` 可选——带了即做乐观锁校验。
 */
export interface McpServiceCreatePayload extends McpServiceBasics {
  name: string
  /** 工具白名单（2026-10-03）：至少一个；创建后可在「工具范围」弹窗里调整 */
  allowed_tools: string[]
  revision?: number
}

/**
 * 新建前的**工具清单探测**结果（契约 §3.9，2026-10-03）。
 *
 * 与 `McpTestResult` 的分工：那个回答"已登记的服务通不通"，这个回答"这个**新**目标有哪些工具"。
 */
export interface McpProbeResult {
  ok: boolean
  tools: McpToolInfo[]
  tools_truncated: boolean
  /** `ok=false` 时的可读原因；`ok=true` 时为 `null` */
  error: string | null
  /** `ok=false` 时的错误码（如 `ADM_RUNTIME_UNREACHABLE`） */
  error_code: string | null
  /** 实际探测目标——界面上 MUST 展示，否则"测的是谁"不可见 */
  target: { transport: 'http' | 'stdio'; url: string | null; command: string | null }
  checked_at: string
}

/**
 * `PUT /api/admin/mcp/services/{name}` 的响应 = **保存后的完整调用配置**（契约 §3.3）。
 *
 * 与 `McpServiceDetail` 的调用配置字段保持**一一对应**（含 `command`／`args`／`updated_at`）：
 * 少一个字段，客户端"拿响应回填"或"保存后重载详情"时就会丢配置
 * （2026-09-25 实测：`async_tools` 漏登导致勾选被清空，同批 `command`／`args` 亦漏登）。
 * 界面据此**原地更新 `revision`**，不再为回填而二次请求详情（契约 §0.5 原则 ②）。
 * `writable` / `permission_scope` 已按 2026-09-15 产品决定从契约移除，此处同步删除。
 */
export interface McpServiceConfigSaved {
  name: string
  description: string
  transport: 'http' | 'stdio'
  url: string | null
  command: string | null
  args: string[] | null
  file_args: Record<string, Record<string, string>>
  rules_fields: Record<string, string>
  async_tools: string[]
  confirmation: McpConfirmation
  /** 工具白名单（2026-10-03）：创建时设定，保存调用配置不改动它（服务端会拒绝携带） */
  allowed_tools: string[]
  /** 请求头（2026-10-08）：同为**掩码值**（界面据此就地刷新展示） */
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

/**
 * 服务级调用汇总（平台卡片用：最近一年调用次数）。
 *
 * 2026-09-23：时间窗已移到分组行 `McpStatsGroup`，此处只留最近一年总量。
 */
export interface McpStatsItem {
  name: string
  /** 调用次数（以下三个计数同此口径）；2026-09-23 起**等于最近一年**（运行环境侧已删独立累计表） */
  calls_total: number
  calls_ok: number
  calls_failed: number
  last_called_at: string | null
}

/**
 * 按「**服务 × 工具 × 用户**」分组的统计行（2026-09-23）—— 统计表的**一行**。
 *
 * `tool_name` 是 MCP 服务自己的工具名（不含 `{server}__` 前缀）；`tool_name` / `user_id`
 * 为 `null` 表示升级前的历史事件未记录该维度（界面显示"未归属·升级前记录"）。
 */
export interface McpStatsGroup {
  service: string
  tool_name: string | null
  user_id: string | null
  calls_total: number
  calls_ok: number
  calls_failed: number
  last_called_at: string | null
  /** 时间窗聚合：最近24h / 7天 / 30天 / 1年 */
  windows?: {
    h24: McpStatsWindow
    d7: McpStatsWindow
    d30: McpStatsWindow
    d365: McpStatsWindow
  }
}

export interface McpStatsResponse {
  stats_available: boolean
  /** 服务级汇总（卡片用） */
  items: McpStatsItem[]
  /** 按「服务 × 工具 × 用户」分组的行（统计表用） */
  groups: McpStatsGroup[]
}

/* ---------- §4 SKILL ---------- */

/**
 * SKILL 类型组（含 §4.8 市场更新的来源标记 `origin`）——**定义在 `./skill-types.ts`**，
 * 本文件再导出，既有引用方一律从 `api/types` 取，无需改动（2026-10-03 拆件，原则二）。
 */
export type {
  SkillDetail,
  SkillFileContent,
  SkillFileSaved,
  SkillInstallResult,
  SkillListItem,
} from './skill-types'

/* ---------- §5 数字人设计 ---------- */

/**
 * 数字人设计相关类型**定义在 `./agent-types.ts`**，本文件再导出（2026-10-13 拆件，原则二：
 * `types.ts` 实测 499 行，距 500 行硬门禁仅 1 行）。既有引用方一律从 `api/types` 取，无需改动。
 */
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
