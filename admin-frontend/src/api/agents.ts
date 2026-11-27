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

export interface AgentCatalog {
  builtin_tools: BuiltinTool[]
  /** 内置工具目录不可读时的可读原因（此时其余候选仍可用） */
  builtin_tools_error: string | null
  mcp_services: McpServiceListItem[]
  skills: SkillListItem[]
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
