
import { parseSseChunk } from '../utils/sse-parser'
import {
  ApiError,
  CLIENT_ERROR_CODE,
  notifyUnauthorized,
  parseErrorResponse,
  type QueryValue,
} from './http'
import type { RawSseEvent } from './types'

export interface SseRequestOptions {
  path: string
  body?: unknown
  baseUrl?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  query?: Record<string, QueryValue>
}

export interface SseHandlers {
  onEvent: (event: RawSseEvent) => void
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

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
    const error = await parseErrorResponse(response)
    notifyUnauthorized(error)
    throw error
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

    if (aborted) {
      throw createAbortError()
    }

    const tail = parseSseChunk(buffer, '')
    for (const event of tail.events) {
      handlers.onEvent(event)
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}

function createAbortError(): Error {
  const error = new Error('流式请求已中止')
  error.name = 'AbortError'
  return error
}
