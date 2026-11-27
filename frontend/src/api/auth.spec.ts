import { describe, expect, it } from 'vitest'
import { createAuthApi } from './auth'
import type { HttpClient } from './http'

interface Call {
  method: string
  path: string
  body?: unknown
}

function recordingClient(): { client: HttpClient; calls: Call[] } {
  const calls: Call[] = []
  const client = {
    baseUrl: '',
    fetchImpl: globalThis.fetch,
    get: async (path: string) => {
      calls.push({ method: 'GET', path })
      if (path.includes('/register-links/')) {
        return { agent: { code: 'DH-1', name: '演示数字人' }, expired: false }
      }
      return { user_id: 'zpf' }
    },
    post: async (path: string, body?: unknown) => {
      calls.push({ method: 'POST', path, body })
      if (path.includes('/register')) return { user_id: 'u_1' }
      return path.includes('/login') ? { user_id: 'zpf' } : undefined
    },
  } as unknown as HttpClient
  return { client, calls }
}

describe('createAuthApi', () => {
  it('login 打 /api/admin/auth/login 并带 user_id/password', async () => {
    const { client, calls } = recordingClient()
    const api = createAuthApi(client)
    await expect(api.login('zpf', '123456')).resolves.toEqual({ user_id: 'zpf' })
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/api/admin/auth/login',
      body: { user_id: 'zpf', password: '123456' },
    })
  })

  it('手机号登录 / 注册链接校验 / 注册走 028 路径', async () => {
    const { client, calls } = recordingClient()
    const api = createAuthApi(client)

    await api.loginWithPhone('13800000000', '123456')
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/api/admin/auth/login',
      body: { phone: '13800000000', password: '123456' },
    })

    await expect(api.lookupRegisterLink('tok/en')).resolves.toEqual({
      agent: { code: 'DH-1', name: '演示数字人' },
      expired: false,
    })
    expect(calls[1]?.path).toBe(`/api/admin/auth/register-links/${encodeURIComponent('tok/en')}`)

    await api.register({
      link_token: 'tok',
      phone: '13800000000',
      display_name: '张三',
      password: '123456',
    })
    expect(calls[2]).toMatchObject({
      method: 'POST',
      path: '/api/admin/auth/register',
    })

    await api.fetchMyAgents()
    expect(calls[3]?.path).toBe('/api/admin/auth/my-agents')
  })

  it('me / logout 路径正确', async () => {
    const { client, calls } = recordingClient()
    const api = createAuthApi(client)
    await expect(api.me()).resolves.toEqual({ user_id: 'zpf' })
    await api.logout()
    expect(calls.map((c) => c.path)).toEqual(['/api/admin/auth/me', '/api/admin/auth/logout'])
  })
})
