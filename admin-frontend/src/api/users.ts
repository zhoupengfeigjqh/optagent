/**
 * 用户与关联数字人 API（`contracts/admin-api.md` §6.1~§6.4）。
 */
import { http } from './http'
import type { Paged, UserDetail, UserListItem } from './types'

/** 部署页兼作**部署前核对总账**（`FR-023`）：默认带搭配摘要 */
export function listUsers(page = 1, expandSummary = true): Promise<Paged<UserListItem>> {
  return http.get<Paged<UserListItem>>('/api/admin/users', {
    page,
    ...(expandSummary ? { expand: 'summary' } : {}),
  })
}

/** 新建用户可携带的账号扩展字段（028 §13；全部可选） */
export interface CreateUserOptions {
  phone?: string
  display_name?: string
  role?: 'admin' | 'user'
}

export function createUser(
  userId: string,
  agents: string[],
  password?: string,
  options?: CreateUserOptions,
): Promise<UserDetail> {
  return http.post<UserDetail>('/api/admin/users', {
    user_id: userId,
    agents,
    ...(password ? { password } : {}),
    ...(options?.phone ? { phone: options.phone } : {}),
    ...(options?.display_name ? { display_name: options.display_name } : {}),
    ...(options?.role ? { role: options.role } : {}),
  })
}

export function updateUser(
  userId: string,
  agents: string[],
  revision: number,
): Promise<UserDetail> {
  return http.put<UserDetail>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    agents,
    revision,
  })
}

/**
 * 重置密码（契约 §6.4.1，2026-11-18）。
 *
 * 专用子资源、**不带 `revision`**：密码不属于部署/配置快照，若占版本会把别人正在
 * 编辑的数字人关联无谓地打成 409。成功后该用户的既有登录会话由服务端一并注销。
 */
export function resetUserPassword(userId: string, password: string): Promise<UserDetail> {
  return http.post<UserDetail>(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
    password,
  })
}

export function deleteUser(userId: string): Promise<void> {
  return http.del<void>(`/api/admin/users/${encodeURIComponent(userId)}`)
}
