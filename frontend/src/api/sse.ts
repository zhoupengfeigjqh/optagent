/**
 * SSE 流式请求（POST + `fetch` + `ReadableStream`）
 *
 * 后端 `POST /api/threads/{id}/messages` 以 `text/event-stream` 返回并保持连接，
 * 在 `done` / `error` 后 `end()`（`contracts/backend-api.md` §4.1）。
 *
 * 断连语义（§4.2）：客户端断开时服务端仅退订事件流，**本轮继续执行并落盘**；
 * 因此前端**不自动重连、不续推**，读取异常直接抛给上层标记为 `failed` 并提供"重新获取"。
 */

import { parseSseChunk } from '../utils/sse-parser'
import { ApiError, CLIENT_ERROR_CODE, parseErrorResponse, type QueryValue } from './http'
import type { RawSseEvent } from './types'

/** 流式请求参数。 */
export interface SseRequestOptions {
  /** 请求路径（含 `/api` 前缀） */
  path: string
  /** 请求体（JSON 序列化） */
  body?: unknown
  baseUrl?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  query?: Record<string, QueryValue>
}

/** 事件回调集合。 */
export interface SseHandlers {
  /** 每解析出一个完整事件即回调（顺序与到达顺序一致） */
  onEvent: (event: RawSseEvent) => void
}

/** 判断错误是否为"调用方主动中止"（`AbortController.abort()`）。 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

/**
 * 发起 SSE 流式 POST 请求，逐事件回调，直至流自然结束或抛出异常。
 *
 * @throws ApiError 非 2xx（携带后端错误码）或读取过程中的网络异常
 */
export async function postSseStream(
  options: SseRequestOptions,
  handlers: SseHandlers,
): Promise<void> {
  const { path, body, baseUrl = '', fetchImpl, signal, query } = options
  const doFetch: typeof fetch = fetchImpl ?? globalThis.fetch.bind(globalThis)

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') {
      continue
    }
    search.append(key, String(value))
  }
  const url = `${baseUrl.replace(/\/+$/, '')}${path}${search.toString() ? `?${search}` : ''}`

  let response: Response
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause
    }
    throw new ApiError({
      code: CLIENT_ERROR_CODE.NETWORK,
      message: cause instanceof Error ? cause.message : '流式请求失败',
    })
  }

  if (!response.ok) {
    throw await parseErrorResponse(response)
  }

  const stream = response.body
  if (!stream) {
    throw new ApiError({
      code: CLIENT_ERROR_CODE.EMPTY_RESPONSE,
      message: '服务端未返回流式响应体',
      status: response.status,
    })
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let aborted = false

  // 主动中止时立即取消读取：真实 `fetch` 会自行中止，但显式 `cancel()` 可保证
  // 任何 `fetch` 实现下挂起的 `read()` 都能及时收敛，避免读取循环永久阻塞。
  const onAbort = (): void => {
    aborted = true
    void reader.cancel().catch(() => undefined)
  }
  if (signal) {
    if (signal.aborted) {
      onAbort()
    } else {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      const parsed = parseSseChunk(buffer, decoder.decode(value, { stream: true }))
      buffer = parsed.rest
      for (const event of parsed.events) {
        handlers.onEvent(event)
      }
    }

    // 被调用方主动中止：抛 AbortError 交由上层标记为 aborted
    if (aborted) {
      throw createAbortError()
    }

    // 流结束：处理尾部残留（正常情况为空，后端以空行收尾）
    const tail = parseSseChunk(buffer, '')
    for (const event of tail.events) {
      handlers.onEvent(event)
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}

/** 构造与 `AbortController.abort()` 语义一致的错误（供 `isAbortError` 识别）。 */
function createAbortError(): Error {
  const error = new Error('流式请求已中止')
  error.name = 'AbortError'
  return error
}
