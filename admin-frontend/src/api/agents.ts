/**
 * 数字人设计 API（`contracts/admin-api.md` §5.1~§5.5）。
 *
 * 类型与契约**一一映射**（原则七）；本模块只做请求编排，不含业务判断。
 */
import { http } from './http'
import type { AgentDesign, AgentDesignPayload, AgentListItem, Paged } from './types'

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
