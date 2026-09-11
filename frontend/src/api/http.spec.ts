import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, CLIENT_ERROR_CODE, createHttpClient } from './http'

/** 构造 JSON 响应。 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 构造后端统一错误体响应。 */
function errorResponse(code: string, message: string, status: number, details?: unknown): Response {
  return jsonResponse({ error: { code, message, details } }, status)
}

describe('createHttpClient - URL 拼接', () => {
  it('baseUrl 结尾斜杠被归一化，避免出现双斜杠', () => {
    const client = createHttpClient({ baseUrl: 'http://localhost:3000/' })

    expect(client.baseUrl).toBe('http://localhost:3000')
    expect(client.url('/api/models')).toBe('http://localhost:3000/api/models')
  })

  it('baseUrl 缺省为空串，请求走同源相对路径（开发期由 Vite 代理，D3）', () => {
    const client = createHttpClient({ baseUrl: '' })

    expect(client.url('/api/models')).toBe('/api/models')
  })

  it('url() 拼接查询串并编码特殊字符', () => {
    const client = createHttpClient({ baseUrl: '' })

    expect(client.url('/api/files/preview', { dir: '生产计划', filename: 'a b.csv' })).toBe(
      '/api/files/preview?dir=%E7%94%9F%E4%BA%A7%E8%AE%A1%E5%88%92&filename=a+b.csv',
    )
  })

  it('url() 省略 undefined / null / 空串参数', () => {
    const client = createHttpClient({ baseUrl: '' })

    expect(client.url('/api/threads', { agent_name: undefined, limit: null, offset: '' })).toBe(
      '/api/threads',
    )
  })

  it('get 把查询参数拼接到最终请求 URL（数字 0 不被省略）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    const client = createHttpClient({ baseUrl: '', fetchImpl: fetchMock as unknown as typeof fetch })

    await client.get('/api/threads/t1', { limit: 50, offset: 0 })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/threads/t1?limit=50&offset=0')
  })
})

describe('createHttpClient - 请求构造', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
  })

  function client(): ReturnType<typeof createHttpClient> {
    return createHttpClient({ baseUrl: '', fetchImpl: fetchMock as unknown as typeof fetch })
  }

  it('GET 请求不带 body 且携带 Accept: application/json', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    await client().get('/api/models')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/models')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect((init.headers as Record<string, string>).Accept).toBe('application/json')
  })

  it('POST 请求序列化 JSON 并设置 Content-Type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ thread_id: 't1' }, 201))

    await client().post('/api/threads', { agent_name: 'ops' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"agent_name":"ops"}')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('PUT / PATCH / DELETE 方法正确', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    const http = client()
    await http.put('/api/a', { value: 'up' })
    await http.patch('/api/b', { title: 'x' })
    await http.del('/api/c')

    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual([
      'PUT',
      'PATCH',
      'DELETE',
    ])
  })

  it('FormData 请求体不设置 Content-Type（交由浏览器生成 boundary）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ dir: 'tmp', filename: 'a.csv', size: 1 }, 201))

    const form = new FormData()
    form.append('dir', 'tmp')
    await client().request('/api/files/upload', { method: 'POST', body: form })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.body).toBe(form)
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('204 无响应体返回 undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(client().del('/api/threads/t1')).resolves.toBeUndefined()
  })

  it('200 空响应体返回 undefined', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }))

    await expect(client().get('/api/threads')).resolves.toBeUndefined()
  })
})

describe('createHttpClient - 统一错误对象', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
  })

  function client(): ReturnType<typeof createHttpClient> {
    return createHttpClient({ baseUrl: '', fetchImpl: fetchMock as unknown as typeof fetch })
  }

  it('非 2xx 抛出携带后端错误码的 ApiError', async () => {
    fetchMock.mockResolvedValue(
      errorResponse('AGENT_NOT_SELECTED', 'agent not selected', 409, { extra: 1 }),
    )

    const error = await client()
      .post('/api/threads', { agent_name: 'ops' })
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('AGENT_NOT_SELECTED')
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).details).toEqual({ extra: 1 })
    expect((error as ApiError).message).toBe('agent not selected')
  })

  it('错误体不符合契约（网关 HTML）时回退为 HTTP_{status}', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }))

    const error = (await client().get('/api/models').catch((cause: unknown) => cause)) as ApiError

    expect(error.code).toBe('HTTP_502')
    expect(error.status).toBe(502)
  })

  it('错误体为 JSON 但缺少 code 时同样回退', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'oops' }, 500))

    const error = (await client().get('/api/models').catch((cause: unknown) => cause)) as ApiError

    expect(error.code).toBe('HTTP_500')
  })

  it('网络异常（fetch reject）→ NETWORK_ERROR', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const error = (await client().get('/api/models').catch((cause: unknown) => cause)) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe(CLIENT_ERROR_CODE.NETWORK)
    expect(error.status).toBe(0)
  })

  it('成功响应体非 JSON → INVALID_RESPONSE', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }))

    const error = (await client().get('/api/models').catch((cause: unknown) => cause)) as ApiError

    expect(error.code).toBe(CLIENT_ERROR_CODE.INVALID_RESPONSE)
  })

  it('ApiError 可直接作为 ErrorInfo 交给文案映射', async () => {
    fetchMock.mockResolvedValue(errorResponse('MODEL_NOT_FOUND', 'x', 400))

    const error = (await client().post('/api/m', {}).catch((cause: unknown) => cause)) as ApiError
    const { toUserMessage } = await import('../utils/error-message')

    expect(toUserMessage(error)).toBe('所选模型不可用，请重新选择')
  })
})
