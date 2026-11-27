import { describe, expect, it, vi } from 'vitest'
import { ApiError, type HttpClient } from '../api/http'
import { createAuthStore } from './useAuth'

interface Handlers {
  me?: () => Promise<unknown>
  login?: (body: unknown) => Promise<unknown>
  logout?: () => Promise<unknown>
  lookupLink?: (token: string) => Promise<unknown>
  register?: (body: unknown) => Promise<unknown>
  myAgents?: () => Promise<unknown>
}

function fakeClient(handlers: Handlers): HttpClient {
  const unused = async (): Promise<unknown> => {
    throw new Error('unused')
  }
  return {
    baseUrl: '',
    fetchImpl: globalThis.fetch,
    request: unused,
    get: (path: string) => {
      if (path.includes('/me')) return (handlers.me ?? unused)()
      if (path.includes('/my-agents')) return (handlers.myAgents ?? unused)()
      if (path.includes('/register-links/')) {
        const token = decodeURIComponent(path.split('/').pop() ?? '')
        return (handlers.lookupLink ?? unused)(token)
      }
      return unused()
    },
    post: (path: string, body?: unknown) => {
      if (path.includes('/login')) return (handlers.login ?? unused)(body)
      if (path.includes('/logout')) return (handlers.logout ?? unused)()
      if (path.includes('/register')) return (handlers.register ?? unused)(body)
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
    const me = async (): Promise<unknown> => ({
      user_id: 'zpf',
      phone: '13800000000',
      display_name: '张三',
    })
    const store = createAuthStore({
      client: fakeClient({ login, me }),
      redirectToLogin: () => {},
    })
    await store.login('zpf', '123456')
    expect(store.currentUser.value?.user_id).toBe('zpf')
    expect(store.currentUser.value?.display_name).toBe('张三')
  })

  it('手机号登录后补齐用户信息', async () => {
    const login = async (): Promise<unknown> => ({ user_id: 'u_1' })
    const me = async (): Promise<unknown> => ({
      user_id: 'u_1',
      phone: '13800000000',
      display_name: '张三',
    })
    const store = createAuthStore({
      client: fakeClient({ login, me }),
      redirectToLogin: () => {},
    })
    await store.loginWithPhone('13800000000', '123456')
    expect(store.currentUser.value).toMatchObject({
      user_id: 'u_1',
      phone: '13800000000',
      display_name: '张三',
    })
  })

  it('注册链接校验与注册透传 API 结果', async () => {
    const lookupLink = vi.fn(async () => ({
      agent: { code: 'DH-1', name: '演示数字人' },
    }))
    const register = vi.fn(async () => ({
      user_id: 'u_1',
      phone: '13800000000',
      display_name: '张三',
      granted_agent: { code: 'DH-1', name: '演示数字人' },
    }))
    const store = createAuthStore({
      client: fakeClient({ lookupLink, register }),
      redirectToLogin: () => {},
    })

    await expect(store.lookupRegisterLink('tok')).resolves.toMatchObject({
      agent: { code: 'DH-1' },
    })
    await expect(
      store.register({
        link_token: 'tok',
        phone: '13800000000',
        display_name: '张三',
        password: '123456',
      }),
    ).resolves.toMatchObject({ user_id: 'u_1' })
  })

  it('读取当前用户已授权数字人', async () => {
    const myAgents = vi.fn(async () => ({
      items: [
        {
          code: 'DH-1',
          name: '演示数字人',
          platform_agent_name: 'demo',
          status: 'approved',
        },
      ],
      pending: [],
    }))
    const store = createAuthStore({
      client: fakeClient({ myAgents }),
      redirectToLogin: () => {},
    })

    await expect(store.fetchMyAgents()).resolves.toMatchObject({
      items: [{ platform_agent_name: 'demo' }],
    })
  })

  it('logout 清空当前用户并跳转', async () => {
    const login = async (): Promise<unknown> => ({ user_id: 'zpf' })
    const me = async (): Promise<unknown> => ({ user_id: 'zpf' })
    const logout = async (): Promise<unknown> => undefined
    const redirect = vi.fn()
    const store = createAuthStore({
      client: fakeClient({ login, me, logout }),
      redirectToLogin: redirect,
    })
    await store.login('zpf', '123456')
    await store.logout()
    expect(store.currentUser.value).toBeNull()
    expect(redirect).toHaveBeenCalledTimes(1)
  })

  it('logout 接口失败也清空登录态并回登录页（登出是本地收口）', async () => {
    const login = async (): Promise<unknown> => ({ user_id: 'zpf' })
    const me = async (): Promise<unknown> => ({ user_id: 'zpf' })
    const logout = async (): Promise<unknown> => {
      throw new ApiError({ code: 'NETWORK', message: '网络不可达', status: 0 })
    }
    const redirect = vi.fn()
    const store = createAuthStore({
      client: fakeClient({ login, me, logout }),
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
