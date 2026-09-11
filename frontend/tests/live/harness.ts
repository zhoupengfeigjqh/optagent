/**
 * live 联调共用工具：**零桩件**把真实 store 接到真实后端。
 *
 * 与 `tests/helpers.ts` 的区别：那里注入 `fetch` 桩；这里注入一个**记录型透传**
 * `fetchImpl`——既真实打到后端，又能断言"发了几次请求、URL 带了什么参数、SSE 原始帧长什么样"。
 *
 * 两处**仅在 jsdom 下必要**的适配（真实浏览器不需要，且不影响被测代码）：
 * 1. multipart 重编码：jsdom 的 `FormData`/`File` 与 Node(undici) 的 `fetch` 不在同一 realm，
 *    直接传会被序列化成空 body（后端报 `VALIDATION_FAILED`）。这里在测试侧按标准 multipart
 *    重新编码，字段名与文件名保持原样，使请求能真实打到后端。
 * 2. SSE 分流：`tee()` 出副本累积原始帧文本，供断言"后端确实按契约发了 tool_call 等事件"。
 */
import { createAppSession, type AppSession } from '../../src/composables/useAppSession'

/** 后端地址（与 `global-setup.ts` 保持一致）。 */
export const LIVE_BASE = process.env.LIVE_BASE_URL ?? 'http://127.0.0.1:3000'

/** live 用例产生的文件统一前缀（可被 prepare-integration-data.ts clean 回收）。 */
export const LIVE_PREFIX = 'itest-live-'

/** 一次真实请求的记录。 */
export interface LiveCall {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
}

/** 带请求记录的会话上下文。 */
export interface LiveSession {
  session: AppSession
  calls: LiveCall[]
  /** 匹配 `METHOD` + 路径包含 `pathPart` 的请求次数 */
  countOf(method: string, pathPart?: string): number
  /** 本轮累积的原始 SSE 文本（`resetCalls` 清空） */
  rawSse(): string
  /** 清空请求与 SSE 记录 */
  resetCalls(): void
}

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

/** 把绝对 URL 归一为 `/api/...` + query。 */
function splitUrl(url: string): { path: string; query: URLSearchParams } {
  const withoutBase = url.startsWith(LIVE_BASE) ? url.slice(LIVE_BASE.length) : url
  const [pathPart = '', search = ''] = withoutBase.split('?')
  return { path: pathPart, query: new URLSearchParams(search) }
}

/**
 * 把 jsdom 的 `FormData` 重编码为标准 multipart。
 *
 * 仅测试环境需要：真实浏览器里 `FormData` 与 `fetch` 同源，不会出现这个问题。
 */
async function encodeFormData(form: FormData): Promise<{ body: Buffer; contentType: string }> {
  const boundary = `----itest-live-${Math.random().toString(16).slice(2)}`
  const chunks: Buffer[] = []
  const push = (text: string): void => {
    chunks.push(Buffer.from(text, 'utf8'))
  }

  for (const [name, value] of form.entries()) {
    push(`--${boundary}\r\n`)
    if (typeof value === 'string') {
      push(`Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
      continue
    }
    const file = value as File
    push(`Content-Disposition: form-data; name="${name}"; filename="${file.name}"\r\n`)
    push(`Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`)
    chunks.push(Buffer.from(await file.arrayBuffer()))
    push('\r\n')
  }
  push(`--${boundary}--\r\n`)
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

/** 创建接入真实后端的会话上下文（不落 storage，避免污染 jsdom 的 sessionStorage）。 */
export function createLiveSession(): LiveSession {
  const calls: LiveCall[] = []
  const state = { sseText: '' }

  /** 把 SSE 响应体分流一份，用于断言原始帧 */
  const captureSse = (response: Response): Response => {
    const contentType = response.headers.get('content-type') ?? ''
    const body = response.body
    if (!body || !contentType.includes('text/event-stream')) return response

    const [forClient, forCapture] = body.tee()
    void (async () => {
      try {
        const reader = forCapture.getReader()
        const decoder = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          state.sseText += decoder.decode(value, { stream: true })
        }
      } catch {
        // 客户端主动 abort（中断本轮）会让副本流抛 AbortError，忽略即可
      }
    })()

    return new Response(forClient, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  const recording = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { path: pathPart, query } = splitUrl(toUrl(input))
    const raw = init?.body
    calls.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      path: pathPart,
      query,
      body: typeof raw === 'string' && raw !== '' ? (JSON.parse(raw) as unknown) : raw,
    })

    let forwarded = init
    if (raw instanceof FormData) {
      const encoded = await encodeFormData(raw)
      const headers = new Headers(init?.headers as HeadersInit | undefined)
      headers.set('content-type', encoded.contentType)
      forwarded = { ...init, body: encoded.body as unknown as BodyInit, headers }
    }

    return captureSse(await globalThis.fetch(input, forwarded))
  }) as typeof fetch

  const session = createAppSession({ baseUrl: LIVE_BASE, fetchImpl: recording, storage: null })

  return {
    session,
    calls,
    countOf: (method, pathPart) =>
      calls.filter((call) => call.method === method && (!pathPart || call.path.includes(pathPart)))
        .length,
    rawSse: () => state.sseText,
    resetCalls: () => {
      calls.length = 0
      state.sseText = ''
    },
  }
}

/* ------------------------------------------------- 用例产物回收（thread） */

const trackedThreads = new Set<string>()

/** 登记用例创建的会话，供 `afterAll` 回收，避免污染手工联调环境。 */
export function trackThread(threadId: string): void {
  trackedThreads.add(threadId)
}

/** 取用例自己创建的会话 id（用于"只删自己造的数据"这类断言）。 */
export function trackedThreadIds(): string[] {
  return [...trackedThreads]
}

/**
 * 准备一个可用会话：**优先新建**；该数字人已达上限（每数字人 3 个）时**复用**既有会话。
 *
 * 只有真正新建出来的会话才会被登记回收——避免把预置数据或用户数据删掉。
 */
export async function ensureThread(live: LiveSession, agentName: string): Promise<string> {
  const { threads } = live.session
  await threads.loadList()

  const before = new Set(threads.list.value.map((item) => item.thread_id))
  await threads.create()

  const created = threads.activeId.value
  if (created && !before.has(created)) {
    trackThread(created)
    return created
  }

  // 无空位：复用该数字人的既有会话（不登记 → 不会被回收）
  const existing = threads.list.value.find((item) => item.agent_name === agentName)
  if (existing) {
    await threads.select(existing.thread_id)
    return existing.thread_id
  }
  throw new Error(`数字人 ${agentName} 既无空位新建、也没有可复用的会话`)
}

/** 删除用例创建的会话（真实走 `DELETE /api/threads/{id}`，顺带验证删除接口）。 */
export async function cleanupTrackedThreads(session: AppSession): Promise<void> {
  for (const id of [...trackedThreads]) {
    await session.threads.remove(id).catch(() => undefined)
    trackedThreads.delete(id)
  }
}

/* --------------------------------------------------------------- 业务小工具 */

/** 确保选中的数字人是指定值（走真实 exit → select 链路）。 */
export async function selectAgent(live: LiveSession, agentName: string): Promise<void> {
  await live.session.agents.switchTo(agentName)
  if (live.session.agents.currentAgent.value?.agent_name !== agentName) {
    throw new Error(`切到数字人 ${agentName} 失败`)
  }
}

/** 造一个真实 `File`。 */
export function makeLiveFile(name: string, content: string, type = 'text/csv'): File {
  return new File([content], name, { type })
}

/** 造一个指定字节数的真实 `File`（用于触发后端 413）。 */
export function makeLargeFile(name: string, bytes: number, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

/** 轮询等待条件成立（用于"落盘后刷新"这类多段异步链路）。 */
export async function until(
  predicate: () => boolean,
  message: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`等待超时：${message}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
