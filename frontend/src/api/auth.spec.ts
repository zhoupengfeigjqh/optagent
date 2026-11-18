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
      return { user_id: 'zpf' }
    },
    post: async (path: string, body?: unknown) => {
      calls.push({ method: 'POST', path, body })
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

  it('me / logout 路径正确', async () => {
    const { client, calls } = recordingClient()
    const api = createAuthApi(client)
    await expect(api.me()).resolves.toEqual({ user_id: 'zpf' })
    await api.logout()
    expect(calls.map((c) => c.path)).toEqual(['/api/admin/auth/me', '/api/admin/auth/logout'])
  })
})
