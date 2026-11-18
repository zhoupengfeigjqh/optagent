/**
 * 登录鉴权 API（`contracts/auth-api.md`）
 *
 * 与运行环境接口同一 `HttpClient`（同源经网关/Vite 代理）。凭据在 HttpOnly Cookie，
 * 前端不读取、不拼 Authorization 头——浏览器自动携带。
 */
import type { HttpClient } from './http'

export interface AuthUser {
  user_id: string
}

export interface AuthApi {
  login(userId: string, password: string): Promise<AuthUser>
  me(): Promise<AuthUser>
  logout(): Promise<void>
}

export function createAuthApi(http: HttpClient): AuthApi {
  return {
    login: (userId, password) =>
      http.post<AuthUser>('/api/admin/auth/login', { user_id: userId, password }),
    me: () => http.get<AuthUser>('/api/admin/auth/me'),
    logout: () => http.post<void>('/api/admin/auth/logout'),
  }
}
