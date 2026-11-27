/**
 * 登录态（聊天前台）
 *
 * - 登录态唯一来源：`GET /api/admin/auth/me` 探针（HttpOnly Cookie 前端读不到）；
 * - `ensureAuthenticated()` 供路由守卫：已登录直接放行，否则探针一次并记忆化；
 * - 401 统一分派：仅"未认证/被踢"跳登录页，登录失败（账号密码错）不跳。
 */
import { ref, type Ref } from 'vue'
import {
  createAuthApi,
  type AuthApi,
  type AuthUser,
  type MyAgents,
  type RegisterInput,
  type RegisterLinkLookup,
  type RegisterResult,
} from '../api/auth'
import { ApiError, createHttpClient, setUnauthorizedHandler, type HttpClient } from '../api/http'

export interface AuthStore {
  readonly currentUser: Ref<AuthUser | null>
  login(userId: string, password: string): Promise<AuthUser>
  loginWithPhone(phone: string, password: string): Promise<AuthUser>
  logout(): Promise<void>
  lookupRegisterLink(token: string): Promise<RegisterLinkLookup>
  register(input: RegisterInput): Promise<RegisterResult>
  fetchMyAgents(): Promise<MyAgents>
  /** 已登录返回 true；否则探针一次（记忆化）并返回结果 */
  ensureAuthenticated(): Promise<boolean>
  handleUnauthorized(error: unknown): void
}

export interface AuthStoreOptions {
  client?: HttpClient
  redirectToLogin?: () => void
}

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
      await api.login(userId, password)
      const user = await api.me()
      currentUser.value = user
      return user
    },

    async loginWithPhone(phone: string, password: string): Promise<AuthUser> {
      await api.loginWithPhone(phone, password)
      const user = await api.me()
      currentUser.value = user
      return user
    },

    async logout(): Promise<void> {
      try {
        await api.logout()
      } finally {
        // 登出是**本地收口**：无论后端是否可达，登录态都已作废，必须回登录页。
        currentUser.value = null
        probe = null
        redirect()
      }
    },

    lookupRegisterLink(token: string): Promise<RegisterLinkLookup> {
      return api.lookupRegisterLink(token)
    },

    register(input: RegisterInput): Promise<RegisterResult> {
      return api.register(input)
    },

    fetchMyAgents(): Promise<MyAgents> {
      return api.fetchMyAgents()
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

export function getAuthStore(): AuthStore {
  if (!defaultStore) defaultStore = createAuthStore()
  return defaultStore
}
