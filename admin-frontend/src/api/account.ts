/**
 * 账号与数字人服务绑定 API（028 §13）：注册链接 / 数字人服务目录。
 *
 * 授权不再有独立接口（2026-11-27）：授权 = `users.agents[]`，
 * 读写统一走 `api/users`（`updateUser` 与列表响应）。
 */
import type { QueryValue } from './http'
import { http } from './http'
import type {
  AgentServiceCreatePayload,
  AgentServiceItem,
  AgentServiceUpdatePayload,
  RegisterLinkCreated,
  RegisterLinkItem,
} from './account-types'

/* ---------- 数字人服务 ---------- */

export function listAgentServices(): Promise<{ items: AgentServiceItem[] }> {
  return http.get<{ items: AgentServiceItem[] }>('/api/admin/agent-services')
}

/*
 * 以下三个写操作（新建 / 改名启停 / 删除）**管理台没有界面入口**（2026-11-27 明确）：
 * 编码由「创建数字人」自动开通、「删除数字人」自动撤销（1:1），日常不需要手工建/删；
 * 保留封装仅供运维脚本复位与将来的服务管理页复用，不要因为"没人调用"而删除——
 * 删掉会让这些端点变成只剩 curl 的裸接口。
 */

/**
 * 新建数字人服务。
 *
 * 不传 `code` 即由平台生成，**必须**用响应里的 `code`（它是注册链接与审计的引用键）；
 * 服务端的创建是插入语义，撞码 400 而不是覆盖。
 */
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
