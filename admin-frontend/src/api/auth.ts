/**
 * 登录鉴权 API（024 §2 + 028 §13 扩展）。
 *
 * `login` 支持 `user_id` 与 `phone` 二选一；`register` 为专属链接注册（不自动登录）。
 */
import { http } from './http'
import type { MeProfile, MyAgents, RegisterLinkLookup, RegisterResult } from './account-types'

export function login(payload: { user_id?: string; phone?: string; password: string }): Promise<{
  user_id: string
}> {
  return http.post<{ user_id: string }>('/api/admin/auth/login', payload)
}

export function logout(): Promise<void> {
  return http.post<void>('/api/admin/auth/logout')
}

/** 登录态探针（028：响应带 phone/display_name/role） */
export function fetchMe(): Promise<MeProfile> {
  return http.get<MeProfile>('/api/admin/auth/me')
}

/**
 * 当前用户**可用**的数字人（对话工作台「切换数字人」用）。
 *
 * 判据是 `users.agents[]` ∩ 部署清单：授权了但未部署的不下发；
 * `pending` 恒为空数组（申请/审批链路已随授权收敛下线，仅为响应契约兼容保留）。
 */
export function fetchMyAgents(): Promise<MyAgents> {
  return http.get<MyAgents>('/api/admin/auth/my-agents')
}

/** 专属链接注册：注册即授权；不自动登录 */
export function register(payload: {
  link_token: string
  phone: string
  display_name: string
  password: string
}): Promise<RegisterResult> {
  return http.post<RegisterResult>('/api/admin/auth/register', payload)
}

/** 注册页渲染前的公开链接校验 */
export function lookupRegisterLink(token: string): Promise<RegisterLinkLookup> {
  return http.get<RegisterLinkLookup>(
    `/api/admin/auth/register-links/${encodeURIComponent(token)}`,
  )
}
