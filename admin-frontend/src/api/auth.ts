/**
 * 登录鉴权 API（024 §2 + 028 §13 扩展）。
 *
 * `login` 支持 `user_id` 与 `phone` 二选一。注册（`/register`、`/register-links/{token}`）
 * 只由前台 `frontend` 调用，管理台没有注册入口，故本文件不再包含这两个接口。
 */
import { http } from './http'
import type { MeProfile } from './account-types'

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
