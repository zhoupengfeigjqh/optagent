import { http } from './http'
import type { Paged, UserDetail, UserListItem } from './types'

/**
 * 用户列表。
 *
 * 2026-11-27：`expand=summary` 随「部署前核对总账」下架一并移除（无消费方），
 * 列表只返回授权数与部署状态，不再计算搭配摘要。
 */
export function listUsers(page = 1): Promise<Paged<UserListItem>> {
  return http.get<Paged<UserListItem>>('/api/admin/users', { page })
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

export function resetUserPassword(userId: string, password: string): Promise<UserDetail> {
  return http.post<UserDetail>(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
    password,
  })
}

export function deleteUser(userId: string): Promise<void> {
  return http.del<void>(`/api/admin/users/${encodeURIComponent(userId)}`)
}
