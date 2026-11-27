/**
 * 账号与数字人服务绑定 API（028 §13）：授权 / 注册链接 / 数字人服务目录。
 */
import type { QueryValue } from './http'
import { http } from './http'
import type { Paged } from './types'
import type {
  AgentServiceCreatePayload,
  AgentServiceItem,
  AgentServiceUpdatePayload,
  GrantApplyResult,
  GrantItem,
  GrantStatus,
  RegisterLinkCreated,
  RegisterLinkItem,
} from './account-types'

/* ---------- 数字人服务 ---------- */

export function listAgentServices(): Promise<{ items: AgentServiceItem[] }> {
  return http.get<{ items: AgentServiceItem[] }>('/api/admin/agent-services')
}

export function createAgentService(payload: AgentServiceCreatePayload): Promise<AgentServiceItem> {
  return http.post<AgentServiceItem>('/api/admin/agent-services', payload)
}

export function updateAgentService(
  code: string,
  payload: AgentServiceUpdatePayload,
): Promise<AgentServiceItem> {
  return http.put<AgentServiceItem>(
    `/api/admin/agent-services/${encodeURIComponent(code)}`,
    payload,
  )
}

export function deleteAgentService(code: string): Promise<void> {
  return http.del<void>(`/api/admin/agent-services/${encodeURIComponent(code)}`)
}

/* ---------- 专属注册链接 ---------- */

export function listRegisterLinks(agentCode?: string): Promise<{ items: RegisterLinkItem[] }> {
  const query: Record<string, QueryValue> = {}
  if (agentCode) query.agent_code = agentCode
  return http.get<{ items: RegisterLinkItem[] }>('/api/admin/register-links', query)
}

/** 生成注册链接；`expiresInSeconds`：秒数，`null` = 长期有效，`undefined` = 用服务端默认 */
export function createRegisterLink(
  agentCode: string,
  expiresInSeconds?: number | null,
): Promise<RegisterLinkCreated> {
  return http.post<RegisterLinkCreated>('/api/admin/register-links', {
    agent_code: agentCode,
    ...(expiresInSeconds === undefined ? {} : { expires_in_seconds: expiresInSeconds }),
  })
}

export function revokeRegisterLink(token: string): Promise<void> {
  return http.del<void>(`/api/admin/register-links/${encodeURIComponent(token)}`)
}

/* ---------- 授权（绑定关联） ---------- */

export function listGrants(filter: {
  status?: GrantStatus
  agentCode?: string
  phone?: string
  page?: number
}): Promise<Paged<GrantItem>> {
  const query: Record<string, QueryValue> = { page: filter.page ?? 1 }
  if (filter.status) query.status = filter.status
  if (filter.agentCode) query.agent_code = filter.agentCode
  if (filter.phone) query.phone = filter.phone
  return http.get<Paged<GrantItem>>('/api/admin/grants', query)
}

export function applyGrant(agentCode: string): Promise<GrantApplyResult> {
  return http.post<GrantApplyResult>('/api/admin/grants/apply', { agent_code: agentCode })
}

export function approveGrant(userId: string, agentCode: string): Promise<GrantApplyResult> {
  return http.post<GrantApplyResult>('/api/admin/grants/approve', {
    user_id: userId,
    agent_code: agentCode,
  })
}

export function revokeGrant(userId: string, agentCode: string): Promise<GrantApplyResult> {
  return http.post<GrantApplyResult>('/api/admin/grants/revoke', {
    user_id: userId,
    agent_code: agentCode,
  })
}
