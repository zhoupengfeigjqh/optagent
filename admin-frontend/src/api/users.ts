import { http } from './http'
import type { Paged, UserDetail, UserListItem } from './types'

export function listUsers(page = 1, expandSummary = true): Promise<Paged<UserListItem>> {
  return http.get<Paged<UserListItem>>('/api/admin/users', {
    page,
    ...(expandSummary ? { expand: 'summary' } : {}),
  })
}

export function createUser(userId: string, agents: string[], password?: string): Promise<UserDetail> {
  return http.post<UserDetail>('/api/admin/users', {
    user_id: userId,
    agents,
    ...(password ? { password } : {}),
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
