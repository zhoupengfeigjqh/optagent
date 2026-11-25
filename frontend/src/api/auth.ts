/**
 * 登录鉴权 API（`contracts/auth-api.md`）
 *
 * 与运行环境接口同一 `HttpClient`（同源经网关/Vite 代理）。凭据在 HttpOnly Cookie，
 * 前端不读取、不拼 Authorization 头——浏览器自动携带。
 */
import type { HttpClient } from './http'

export interface AuthUser {
  user_id: string
  phone?: string | null
  display_name?: string | null
  role?: 'admin' | 'user'
}

export interface RegisterLinkLookup {
  agent: { code: string; name: string }
  expired: boolean
}

export interface RegisterResult {
  user_id: string
  phone: string
  display_name: string
  granted_agent: { code: string; name: string }
}

export interface RegisterInput {
  link_token: string
  phone: string
  display_name: string
  password: string
}

export interface AuthApi {
  login(userId: string, password: string): Promise<AuthUser>
  loginWithPhone(phone: string, password: string): Promise<AuthUser>
  me(): Promise<AuthUser>
  logout(): Promise<void>
  lookupRegisterLink(token: string): Promise<RegisterLinkLookup>
  register(input: RegisterInput): Promise<RegisterResult>
}

export function createAuthApi(http: HttpClient): AuthApi {
  return {
    login: (userId, password) =>
      http.post<AuthUser>('/api/admin/auth/login', { user_id: userId, password }),
    loginWithPhone: (phone, password) =>
      http.post<AuthUser>('/api/admin/auth/login', { phone, password }),
    me: () => http.get<AuthUser>('/api/admin/auth/me'),
    logout: () => http.post<void>('/api/admin/auth/logout'),
    lookupRegisterLink: (token) =>
      http.get<RegisterLinkLookup>(`/api/admin/auth/register-links/${encodeURIComponent(token)}`),
    register: (input) => http.post<RegisterResult>('/api/admin/auth/register', input),
  }
}
