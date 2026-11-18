/**
 * 登录态（聊天前台）
 *
 * - 登录态唯一来源：`GET /api/admin/auth/me` 探针（HttpOnly Cookie 前端读不到）；
 * - `ensureAuthenticated()` 供路由守卫：已登录直接放行，否则探针一次并记忆化；
 * - 401 统一分派：仅"未认证/被踢"跳登录页，登录失败（账号密码错）不跳。
 */
import { ref, type Ref } from 'vue'
import { createAuthApi, type AuthApi, type AuthUser } from '../api/auth'
import { ApiError, createHttpClient, setUnauthorizedHandler, type HttpClient } from '../api/http'

export interface AuthStore {
  readonly currentUser: Ref<AuthUser | null>
  login(userId: string, password: string): Promise<AuthUser>
  logout(): Promise<void>
  /** 已登录返回 true；否则探针一次（记忆化）并返回结果 */
  ensureAuthenticated(): Promise<boolean>
  handleUnauthorized(error: unknown): void
}

export interface AuthStoreOptions {
  client?: HttpClient
  /** 未认证/被踢时的跳转；默认 `window.location.replace('/login')` */
  redirectToLogin?: () => void
}

/** 触发"跳登录页"的 401 错误码；`ADM_INVALID_CREDENTIALS` 不在其列（登录失败只提示） */
const AUTH_REJECT_CODES = new Set(['UNAUTHENTICATED', 'ADM_UNAUTHENTICATED', 'SESSION_REVOKED'])

export function createAuthStore(options: AuthStoreOptions = {}): AuthStore {
  const client = options.client ?? createHttpClient()
  const api: AuthApi = createAuthApi(client)
  const currentUser = ref<AuthUser | null>(null)
  let probe: Promise<AuthUser | null> | null = null

  const redirect =
    options.redirectToLogin ??
    ((): void => {
      try {
        const loc = globalThis.location
        if (loc && loc.pathname !== '/login') loc.replace('/login')
      } catch {
        /* 非浏览器环境：忽略 */
      }
    })

  function handleUnauthorized(error: unknown): void {
    if (!(error instanceof ApiError)) return
    if (!AUTH_REJECT_CODES.has(error.code)) return
    currentUser.value = null
    probe = null
    redirect()
  }

  // 任一请求 401 时统一分派（`http.ts` / `sse.ts` 共用同一处理器）
  setUnauthorizedHandler((err) => handleUnauthorized(err))

  async function probeOnce(): Promise<AuthUser | null> {
    try {
      const user = await api.me()
      currentUser.value = user
      return user
    } catch {
      currentUser.value = null
      return null
    } finally {
      probe = null
    }
  }

  return {
    currentUser,

    async login(userId: string, password: string): Promise<AuthUser> {
      const user = await api.login(userId, password)
      currentUser.value = user
      return user
    },

    async logout(): Promise<void> {
      try {
        await api.logout()
      } finally {
        // 登出是**本地收口**：无论后端是否可达，登录态都已作废，必须回登录页。
        // 若把 redirect 放在 try 之后，登出接口失败会留下"已清登录态但仍显示聊天界面"
        // 的错位状态（2026-11-18 收进账号菜单时一并修正）。
        currentUser.value = null
        probe = null
        redirect()
      }
    },

    async ensureAuthenticated(): Promise<boolean> {
      if (currentUser.value) return true
      if (!probe) probe = probeOnce()
      const user = await probe
      return user !== null
    },

    handleUnauthorized,
  }
}

let defaultStore: AuthStore | null = null

/** 全局单例：路由守卫与登录页共用。 */
export function getAuthStore(): AuthStore {
  if (!defaultStore) defaultStore = createAuthStore()
  return defaultStore
}
