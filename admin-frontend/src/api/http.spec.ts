/**
 * 单元测试：HTTP 薄封装（原则七）
 *
 * 覆盖 BaseURL 拼接、查询串编码、JSON 编解码、multipart 透传，
 * 以及全部错误分支（网络失败 / 非 JSON / 非契约错误体 / 204 空响应）。
 */
import { describe, expect, it, vi } from 'vitest'
import { ApiError, CLIENT_ERROR_CODE, createHttpClient, parseErrorResponse } from './http'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 每次调用返回**新的** Response（Response 的 body 只能读一次） */
function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async () => jsonResponse(body, status))
}

describe('createHttpClient', () => {
  it('GET：拼接同源相对路径与查询串，忽略空值', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const client = createHttpClient({ baseUrl: '', fetchImpl: fetchImpl as never })

    await client.get('/api/admin/agents', { page: 2, empty: '', nil: null, skip: undefined })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe('/api/admin/agents?page=2')
  })

  it('baseUrl 结尾斜杠被去掉（避免出现 //api）', () => {
    const client = createHttpClient({ baseUrl: '/admin///', fetchImpl: vi.fn() as never })
    expect(client.baseUrl).toBe('/admin')
    expect(client.url('/api/x')).toBe('/admin/api/x')
  })

  it('POST / PUT：自动设置 JSON Content-Type 并序列化 body', async () => {
    const fetchImpl = stubFetch({})
    const client = createHttpClient({ fetchImpl: fetchImpl as never })

    await client.post('/api/admin/agents', { name: 'demo' })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"name":"demo"}')

    await client.put('/api/admin/agents/demo', { soul: 'x' })
    expect((fetchImpl.mock.calls[1]?.[1] as RequestInit).method).toBe('PUT')
  })

  it('multipart：FormData 原样透传，且**不**手工设置 Content-Type（由浏览器带 boundary）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}))
    const client = createHttpClient({ fetchImpl: fetchImpl as never })
    const form = new FormData()
    form.append('a', 'b')

    await client.post('/api/admin/skills/install', form)

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.body).toBe(form)
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('204 与空响应体都返回 undefined（不报"非 JSON"）', async () => {
    const noContent = createHttpClient({
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 204 })) as never,
    })
    expect(await noContent.del('/api/admin/skills/x')).toBeUndefined()

    const empty = createHttpClient({
      fetchImpl: vi.fn().mockResolvedValue(new Response('  ', { status: 200 })) as never,
    })
    expect(await empty.get('/api/admin/x')).toBeUndefined()
  })

  it('网络失败 → ApiError(NETWORK_ERROR)', async () => {
    const client = createHttpClient({
      fetchImpl: vi.fn().mockRejectedValue(new Error('connection refused')) as never,
    })
    let caught: unknown
    try {
      await client.get('/api/admin/x')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe(CLIENT_ERROR_CODE.NETWORK)
    expect((caught as ApiError).status).toBe(0)
  })

  it('响应不是合法 JSON → ApiError(INVALID_RESPONSE)', async () => {
    const client = createHttpClient({
      fetchImpl: vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })) as never,
    })
    let caught: unknown
    try {
      await client.get('/api/admin/x')
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe(CLIENT_ERROR_CODE.INVALID_RESPONSE)
  })

  it('非 2xx 且符合契约 → 保留后端错误码与 details', async () => {
    const client = createHttpClient({
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: { code: 'ADM_DEPLOY_VALIDATION_FAILED', message: 'x', details: { errors: [1] } } },
            409,
          ),
        ) as never,
    })
    let caught: unknown
    try {
      await client.get('/api/admin/x')
    } catch (err) {
      caught = err
    }
    const error = caught as ApiError
    expect(error.code).toBe('ADM_DEPLOY_VALIDATION_FAILED')
    expect(error.status).toBe(409)
    expect(error.details).toEqual({ errors: [1] })
  })
})

describe('parseErrorResponse', () => {
  it('响应体不符合契约 → 回退 HTTP_{status}（网关 HTML 错误页场景）', async () => {
    const response = new Response('<html>502 Bad Gateway</html>', { status: 502 })
    const error = await parseErrorResponse(response)
    expect(error.code).toBe('HTTP_502')
    expect(error.status).toBe(502)
  })

  it('code 为空串视为不符合契约', async () => {
    const error = await parseErrorResponse(jsonResponse({ error: { code: '', message: 'x' } }, 500))
    expect(error.code).toBe('HTTP_500')
  })

  it('能区分 `ErrorInfo`（供文案映射使用）', () => {
    const error = new ApiError({ code: 'ADM_USER_NOT_FOUND', message: 'raw' })
    expect(error.code).toBe('ADM_USER_NOT_FOUND')
    expect(error).toBeInstanceOf(Error)
  })
})
