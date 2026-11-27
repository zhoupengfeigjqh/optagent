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
