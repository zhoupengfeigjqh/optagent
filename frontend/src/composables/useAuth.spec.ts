import { describe, expect, it, vi } from 'vitest'
import { ApiError, type HttpClient } from '../api/http'
import { createAuthStore } from './useAuth'

interface Handlers {
  me?: () => Promise<unknown>
  login?: (body: unknown) => Promise<unknown>
  logout?: () => Promise<unknown>
}

function fakeClient(handlers: Handlers): HttpClient {
  const unused = async (): Promise<unknown> => {
    throw new Error('unused')
  }
  return {
    baseUrl: '',
    fetchImpl: globalThis.fetch,
    request: unused,
    get: (path: string) => (path.includes('/me') ? (handlers.me ?? unused)() : unused()),
    post: (path: string, body?: unknown) => {
      if (path.includes('/login')) return (handlers.login ?? unused)(body)
      if (path.includes('/logout')) return (handlers.logout ?? unused)()
      return unused()
    },
    put: unused,
    patch: unused,
    del: unused,
    url: () => '',
  } as unknown as HttpClient
}

describe('createAuthStore', () => {
  it('ensureAuthenticated：探针成功为 true，并记忆化只探一次', async () => {
    const me = vi.fn(async () => ({ user_id: 'zpf' }))
    const store = createAuthStore({ client: fakeClient({ me }), redirectToLogin: () => {} })
    await expect(store.ensureAuthenticated()).resolves.toBe(true)
    expect(store.currentUser.value?.user_id).toBe('zpf')
    await expect(store.ensureAuthenticated()).resolves.toBe(true)
    expect(me).toHaveBeenCalledTimes(1)
  })

  it('ensureAuthenticated：探针 401 → false', async () => {
    const me = async (): Promise<unknown> => {
      throw new ApiError({ code: 'ADM_UNAUTHENTICATED', message: '未登录', status: 401 })
    }
    const store = createAuthStore({ client: fakeClient({ me }), redirectToLogin: () => {} })
    await expect(store.ensureAuthenticated()).resolves.toBe(false)
    expect(store.currentUser.value).toBeNull()
  })

  it('login 设置当前用户', async () => {
    const login = async (): Promise<unknown> => ({ user_id: 'zpf' })
    const store = createAuthStore({ client: fakeClient({ login }), redirectToLogin: () => {} })
    await store.login('zpf', '123456')
    expect(store.currentUser.value?.user_id).toBe('zpf')
  })

  it('logout 清空当前用户并跳转', async () => {
    const login = async (): Promise<unknown> => ({ user_id: 'zpf' })
    const logout = async (): Promise<unknown> => undefined
    const redirect = vi.fn()
    const store = createAuthStore({
      client: fakeClient({ login, logout }),
      redirectToLogin: redirect,
    })
    await store.login('zpf', '123456')
    await store.logout()
    expect(store.currentUser.value).toBeNull()
    expect(redirect).toHaveBeenCalledTimes(1)
  })

  it('logout 接口失败也清空登录态并回登录页（登出是本地收口）', async () => {
    const login = async (): Promise<unknown> => ({ user_id: 'zpf' })
    const logout = async (): Promise<unknown> => {
      throw new ApiError({ code: 'NETWORK', message: '网络不可达', status: 0 })
    }
    const redirect = vi.fn()
    const store = createAuthStore({
      client: fakeClient({ login, logout }),
      redirectToLogin: redirect,
    })
    await store.login('zpf', '123456')

    await expect(store.logout()).rejects.toThrow()
    expect(store.currentUser.value).toBeNull()
    expect(redirect).toHaveBeenCalledTimes(1)
  })

  it('401 分派：仅未认证/被踢跳登录，登录失败不跳', () => {
    const redirect = vi.fn()
    const store = createAuthStore({ client: fakeClient({}), redirectToLogin: redirect })

    store.handleUnauthorized(
      new ApiError({ code: 'ADM_INVALID_CREDENTIALS', message: '账号或密码错误', status: 401 }),
    )
    expect(redirect).not.toHaveBeenCalled()

    store.handleUnauthorized(
      new ApiError({ code: 'ADM_UNAUTHENTICATED', message: '未登录', status: 401 }),
    )
    expect(redirect).toHaveBeenCalledTimes(1)

    store.handleUnauthorized(
      new ApiError({ code: 'SESSION_REVOKED', message: '已在其它设备登录', status: 401 }),
    )
    expect(redirect).toHaveBeenCalledTimes(2)
  })
})
