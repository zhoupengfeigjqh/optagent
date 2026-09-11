/**
 * 测试公共桩件
 *
 * 仅被 `*.spec.ts` 引用，不参与构建产物。
 */

import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, provide, type Component } from 'vue'
import { vi } from 'vitest'

import { APP_SESSION_KEY, createAppSession } from '../src/composables/useAppSession'

/* ---------- HTTP ---------- */

/** 构造 JSON 响应。 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 构造后端统一错误体响应。 */
export function errorResponse(code: string, message = '', status = 400): Response {
  return jsonResponse({ error: { code, message } }, status)
}

/** 一次请求的记录。 */
export interface RecordedCall {
  method: string
  url: string
  path: string
  query: URLSearchParams
  body: unknown
}

/** 路由处理上下文。 */
export interface RouteContext {
  call: RecordedCall
  /** 解析后的请求体（JSON 时已反序列化，FormData 时原样） */
  body: unknown
}

export type RouteHandler = (context: RouteContext) => Response | Promise<Response>

/** 路由桩：键为 `"METHOD /path"`。 */
export interface FetchRouter {
  fetch: typeof fetch
  calls: RecordedCall[]
  /** 按方法+路径统计调用次数 */
  countOf(method: string, path: string): number
  /** 取某方法+路径的全部请求体 */
  bodiesOf(method: string, path: string): unknown[]
}

/**
 * 创建按 `"METHOD /path"` 分派的 `fetch` 桩。
 *
 * 未匹配到路由时抛错，避免测试因"意外请求"而静默通过。
 */
export function createFetchRouter(routes: Record<string, RouteHandler>): FetchRouter {
  const calls: RecordedCall[] = []

  const impl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const [pathname, search = ''] = rawUrl.split('?')
    const method = (init.method ?? 'GET').toUpperCase()
    const body =
      typeof init.body === 'string' && init.body !== '' ? (JSON.parse(init.body) as unknown) : init.body

    const call: RecordedCall = {
      method,
      url: rawUrl,
      path: pathname,
      query: new URLSearchParams(search),
      body,
    }
    calls.push(call)

    const handler = routes[`${method} ${pathname}`]
    if (!handler) {
      throw new Error(`测试桩未匹配到路由：${method} ${pathname}`)
    }
    return handler({ call, body })
  })

  return {
    fetch: impl as unknown as typeof fetch,
    calls,
    countOf: (method, path) =>
      calls.filter((call) => call.method === method && call.path === path).length,
    bodiesOf: (method, path) =>
      calls.filter((call) => call.method === method && call.path === path).map((call) => call.body),
  }
}

/* ---------- SSE ---------- */

/** 把字符串分片包装为 `ReadableStream`。 */
export function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
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

/** 构造单个 SSE 事件帧。 */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`
}

/** 构造 `text/event-stream` 响应。 */
export function sseResponse(frames: string[], status = 200): Response {
  return new Response(streamOf(frames), {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/* ---------- 存储 ---------- */

/** 内存版 `Storage`（测试用，避免污染真实 sessionStorage）。 */
export function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    get length(): number {
      return map.size
    },
    clear: (): void => {
      map.clear()
    },
    getItem: (key: string): string | null => map.get(key) ?? null,
    key: (index: number): string | null => [...map.keys()][index] ?? null,
    removeItem: (key: string): void => {
      map.delete(key)
    },
    setItem: (key: string, value: string): void => {
      map.set(key, String(value))
    },
  }
}

/* ---------- 其它 ---------- */

/** 可控的 promise（用于断言"进行中"状态）。 */
export function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 等待所有微任务与一个宏任务，让链式 await 收敛。 */
export async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * 轮询等待条件成立（用于"发送后等待落盘刷新"这类多段异步链路）。
 *
 * 比固定次数的 `flush()` 更稳健：不会因实现内部 await 层数变化而偶发失败。
 */
export async function waitFor(
  predicate: () => boolean,
  message = '等待条件超时',
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(message)
    }
    await flush()
  }
}

/** 构造 `File`（jsdom 提供实现）。 */
export function makeFile(name: string, size: number, type = 'text/csv'): File {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

/* ---------- 会话上下文 ---------- */

/**
 * 在注入的会话上下文（`provide(APP_SESSION_KEY)`）下挂载组件。
 *
 * 用于依赖 `useXxx()` 访问器的组件：返回 wrapper 与可直接驱动的会话 store。
 */
export function mountInSession(
  component: Component,
  options: {
    props?: Record<string, unknown>
    session?: ReturnType<typeof createAppSession>
    sessionOptions?: Parameters<typeof createAppSession>[0]
  } = {},
): { wrapper: VueWrapper; session: ReturnType<typeof createAppSession> } {
  const session = options.session ?? createAppSession(options.sessionOptions ?? {})
  const Host = defineComponent({
    name: 'SessionHost',
    setup() {
      provide(APP_SESSION_KEY, session)
      return () => h(component, options.props ?? {})
    },
  })
  return { wrapper: mount(Host), session }
}
