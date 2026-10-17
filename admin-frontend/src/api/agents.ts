/**
 * 数字人设计 API（`contracts/admin-api.md` §5.1~§5.5）。
 *
 * 类型与契约**一一映射**（原则七）；本模块只做请求编排，不含业务判断。
 */
import { http } from './http'
import type { OntologyCandidate } from './ontologies'
import type {
  AgentDesign,
  AgentDesignPayload,
  AgentListItem,
  BuiltinTool,
  McpServiceListItem,
  Paged,
  SkillListItem,
} from './types'

/**
 * 设计器候选目录（§5.6，2026-10-17）。
 *
 * 与卡片列表的区别：**一次返回全部候选、不分页**。设计器需要枚举全量才能让人选到
 * 第 9 个 SKILL —— 卡片列表固定 8 条一页（服务端写死），不适合做候选来源。
 */
export interface AgentCatalog {
  builtin_tools: BuiltinTool[]
  /** 内置工具目录不可读时的可读原因（此时其余候选仍可用） */
  builtin_tools_error: string | null
  mcp_services: McpServiceListItem[]
  skills: SkillListItem[]
  /**
   * 本体候选（2026-10-17，`FR-058`）：身份投影，不含正文。
   * 引用值取 `{scenario}/{ontology_dir}`，显示名取 `{场景名}-{本体名}`。
   */
  ontologies: OntologyCandidate[]
}

export function getAgentCatalog(): Promise<AgentCatalog> {
  return http.get<AgentCatalog>('/api/admin/agents/catalog')
}

export function listAgents(page = 1): Promise<Paged<AgentListItem>> {
  return http.get<Paged<AgentListItem>>('/api/admin/agents', { page })
}

export function getAgent(name: string): Promise<AgentDesign> {
  return http.get<AgentDesign>(`/api/admin/agents/${encodeURIComponent(name)}`)
}

export function createAgent(payload: AgentDesignPayload): Promise<AgentDesign> {
  return http.post<AgentDesign>('/api/admin/agents', payload)
}

export function updateAgent(name: string, payload: AgentDesignPayload): Promise<AgentDesign> {
  return http.put<AgentDesign>(`/api/admin/agents/${encodeURIComponent(name)}`, payload)
}

export function deleteAgent(name: string): Promise<void> {
  return http.del<void>(`/api/admin/agents/${encodeURIComponent(name)}`)
}
