import { http } from './http'
import type { Paged, UserDetail, UserListItem } from './types'

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

export function resetUserPassword(userId: string, password: string): Promise<UserDetail> {
  return http.post<UserDetail>(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
    password,
  })
}

export function deleteUser(userId: string): Promise<void> {
  return http.del<void>(`/api/admin/users/${encodeURIComponent(userId)}`)
}
