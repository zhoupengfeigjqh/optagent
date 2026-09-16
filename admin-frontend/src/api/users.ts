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

export function createUser(userId: string, agents: string[]): Promise<UserDetail> {
  return http.post<UserDetail>('/api/admin/users', { user_id: userId, agents })
}

export function updateUser(userId: string, agents: string[], revision: number): Promise<UserDetail> {
  return http.put<UserDetail>(`/api/admin/users/${encodeURIComponent(userId)}`, { agents, revision })
}

export function deleteUser(userId: string): Promise<void> {
  return http.del<void>(`/api/admin/users/${encodeURIComponent(userId)}`)
}
