import { describe, expect, it, vi } from 'vitest'

import { ApiError } from './http'
import { isAbortError, postSseStream } from './sse'

/** 用给定分片构造 `ReadableStream`，模拟 TCP 分片。 */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

/** 构造一个 `text/event-stream` 响应。 */
function sseResponse(chunks: string[], status = 200): Response {
  return new Response(streamFromChunks(chunks), {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function frame(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

describe('postSseStream - 正常流', () => {
  it('以 POST + Accept: text/event-stream 发起请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([frame('done', '{}')]))

    await postSseStream(
      { path: '/api/threads/t1/messages', body: { content: 'hi' }, fetchImpl: fetchMock },
      { onEvent: () => undefined },
    )

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/threads/t1/messages')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Accept).toBe('text/event-stream')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"content":"hi"}')
  })

  it('按到达顺序回调全部事件', async () => {
    const chunks = [
      frame('thinking', '{"delta":"想"}'),
      frame('content', '{"delta":"你"}'),
      frame('tool_call', '{"call_id":"c1","name":"read_file","status":"running"}'),
      frame('tool_call_end', '{"call_id":"c1","status":"success"}'),
      frame('done', '{"finish_reason":"completed"}'),
    ]
    const received: string[] = []

    await postSseStream(
      { path: '/api/x', fetchImpl: vi.fn().mockResolvedValue(sseResponse(chunks)) },
      { onEvent: (event) => received.push(event.event) },
    )

    expect(received).toEqual(['thinking', 'content', 'tool_call', 'tool_call_end', 'done'])
  })

  it('跨分片（含逐字节）仍能完整解析', async () => {
    const full =
      frame('content', '{"delta":"hello"}') + frame('done', '{"finish_reason":"completed"}')
    const received: string[] = []

    await postSseStream(
      { path: '/api/x', fetchImpl: vi.fn().mockResolvedValue(sseResponse([...full])) },
      { onEvent: (event) => received.push(event.event) },
    )

    expect(received).toEqual(['content', 'done'])
  })

  it('事件数据为原始 JSON 字符串，由上层解码', async () => {
    const received: { event: string; data: string }[] = []

    await postSseStream(
      {
        path: '/api/x',
        fetchImpl: vi
          .fn()
          .mockResolvedValue(sseResponse([frame('content', '{"delta":"a"}')])),
      },
      { onEvent: (event) => received.push(event) },
    )

    expect(received[0]).toEqual({ event: 'content', data: '{"delta":"a"}' })
  })

  it('baseUrl 与查询串正确拼接', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]))

    await postSseStream(
      { path: '/api/x', baseUrl: 'http://localhost:3000/', query: { debug: 1 }, fetchImpl: fetchMock },
      { onEvent: () => undefined },
    )

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3000/api/x?debug=1')
  })
})

describe('postSseStream - 失败与断连', () => {
  it('非 2xx 抛出携带后端错误码的 ApiError（不进入读取循环）', async () => {
    const response = new Response(
      JSON.stringify({ error: { code: 'THREAD_RUN_ACTIVE', message: 'busy' } }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )

    const error = (await postSseStream(
      { path: '/api/x', fetchImpl: vi.fn().mockResolvedValue(response) },
      { onEvent: () => undefined },
    ).catch((cause: unknown) => cause)) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('THREAD_RUN_ACTIVE')
    expect(error.status).toBe(409)
  })

  it('响应无流式响应体 → EMPTY_RESPONSE', async () => {
    const response = new Response(null, { status: 200 })

    const error = (await postSseStream(
      { path: '/api/x', fetchImpl: vi.fn().mockResolvedValue(response) },
      { onEvent: () => undefined },
    ).catch((cause: unknown) => cause)) as ApiError

    expect(error.code).toBe('EMPTY_RESPONSE')
  })

  it('网络异常 → NETWORK_ERROR', async () => {
    const error = (await postSseStream(
      { path: '/api/x', fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) },
      { onEvent: () => undefined },
    ).catch((cause: unknown) => cause)) as ApiError

    expect(error.code).toBe('NETWORK_ERROR')
  })

  it('读取中断 → 向上抛出异常（由上层标记 failed 并提供"重新获取"，FR-050）', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame('content', '{"delta":"a"}')))
        controller.error(new Error('connection reset'))
      },
    })

    const error = (await postSseStream(
      { path: '/api/x', fetchImpl: vi.fn().mockResolvedValue(new Response(stream)) },
      { onEvent: () => undefined },
    ).catch((cause: unknown) => cause)) as Error

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('connection reset')
  })

  it('主动 abort 抛出的 AbortError 被识别为中止（非失败）', async () => {
    const abortError = new DOMException('aborted', 'AbortError')

    const error = (await postSseStream(
      { path: '/api/x', fetchImpl: vi.fn().mockRejectedValue(abortError) },
      { onEvent: () => undefined },
    ).catch((cause: unknown) => cause)) as unknown

    expect(isAbortError(error)).toBe(true)
  })

  it('非中止错误不被识别为 AbortError', () => {
    expect(isAbortError(new Error('x'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })
})
