/**
 * HTTP 薄封装（无业务逻辑）
 *
 * 职责：BaseURL 拼接、JSON 编解码、**统一错误对象**。
 * 后端错误体为 `{ error: { code, message, details? } }`（`contracts/backend-api.md`），
 * 非 2xx 一律抛出结构化的 `ApiError`，由上层经 `utils/error-message.ts` 映射为中文文案。
 *
 * 所有请求路径以 `/api` 开头；`baseUrl` 缺省为空串（同源相对路径，开发期由 Vite 代理转发，D3）。
 */

import type { ApiErrorBody, ErrorInfo } from './types'

/** 网络层错误码（非后端返回，由前端在传输层生成）。 */
export const CLIENT_ERROR_CODE = {
  /** 请求未能到达服务端（断网、DNS、CORS、服务未启动） */
  NETWORK: 'NETWORK_ERROR',
  /** 响应体不是合法 JSON */
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  /** 响应体为空但调用方期望 JSON */
  EMPTY_RESPONSE: 'EMPTY_RESPONSE',
} as const

/** 结构化 API 错误：满足 `ErrorInfo`，可直接交给 `toUserMessage()` 映射。 */
export class ApiError extends Error implements ErrorInfo {
  readonly code: string
  readonly status: number
  readonly details?: unknown

  constructor(params: { code: string; message: string; status?: number; details?: unknown }) {
    super(params.message)
    this.name = 'ApiError'
    this.code = params.code
    this.status = params.status ?? 0
    this.details = params.details
  }
}

/** 查询参数取值（`undefined` 的键会被省略）。 */
export type QueryValue = string | number | boolean | undefined | null

/** 请求选项。 */
export interface RequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, QueryValue>
  signal?: AbortSignal
  headers?: Record<string, string>
}

/** HTTP 客户端接口。 */
export interface HttpClient {
  /** 基础地址（用于拼接下载/预览等直链 URL） */
  readonly baseUrl: string
  /** 当前使用的 `fetch` 实现（供流式读取等非 JSON 场景复用，测试可注入桩） */
  readonly fetchImpl: typeof fetch
  request<T>(path: string, options?: RequestOptions): Promise<T>
  get<T>(path: string, query?: Record<string, QueryValue>): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  put<T>(path: string, body?: unknown): Promise<T>
  patch<T>(path: string, body?: unknown): Promise<T>
  del<T>(path: string): Promise<T>
  /** 拼接完整 URL（含查询串），供 `<a download>` 与 `<iframe>` 直接使用 */
  url(path: string, query?: Record<string, QueryValue>): string
}

/** 客户端构造参数。 */
export interface HttpClientOptions {
  /** 默认取 `import.meta.env.VITE_API_BASE_URL`，缺省为空串 */
  baseUrl?: string
  /** 测试注入用的 `fetch` 实现 */
  fetchImpl?: typeof fetch
}

/** 解析默认 BaseURL（去掉结尾斜杠，避免出现 `//api`）。 */
export function resolveBaseUrl(): string {
  const configured = import.meta.env?.VITE_API_BASE_URL ?? ''
  return configured.replace(/\/+$/, '')
}

/** 创建 HTTP 客户端。 */
export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const baseUrl = (options.baseUrl ?? resolveBaseUrl()).replace(/\/+$/, '')
  const fetchImpl: typeof fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)

  function url(path: string, query?: Record<string, QueryValue>): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') {
        continue
      }
      search.append(key, String(value))
    }
    const queryString = search.toString()
    return `${baseUrl}${path}${queryString ? `?${queryString}` : ''}`
  }

  async function request<T>(path: string, requestOptions: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, query, signal, headers } = requestOptions
    const init: RequestInit = { method, signal }

    const mergedHeaders: Record<string, string> = { Accept: 'application/json', ...headers }
    if (body !== undefined && body !== null) {
      if (body instanceof FormData) {
        // multipart：交由浏览器自动生成带 boundary 的 Content-Type
        init.body = body
      } else {
        mergedHeaders['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
    }
    if (Object.keys(mergedHeaders).length > 0) {
      init.headers = mergedHeaders
    }

    let response: Response
    try {
      response = await fetchImpl(url(path, query), init)
    } catch (cause) {
      throw new ApiError({
        code: CLIENT_ERROR_CODE.NETWORK,
        message: cause instanceof Error ? cause.message : '网络请求失败',
      })
    }

    if (!response.ok) {
      throw await parseErrorResponse(response)
    }

    if (response.status === 204) {
      return undefined as T
    }

    const text = await response.text()
    if (text.trim() === '') {
      return undefined as T
    }

    try {
      return JSON.parse(text) as T
    } catch {
      throw new ApiError({
        code: CLIENT_ERROR_CODE.INVALID_RESPONSE,
        message: '服务端返回了非 JSON 响应',
        status: response.status,
      })
    }
  }

  return {
    baseUrl,
    fetchImpl,
    request,
    url,
    get: <T>(path: string, query?: Record<string, QueryValue>) => request<T>(path, { query }),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
    put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
    patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
    del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  }
}

/**
 * 把非 2xx 响应转换为 `ApiError`。
 *
 * 后端契约：`{ error: { code, message, details? } }`；若响应体不符合契约（如网关 HTML 错误页），
 * 回退为 `HTTP_{status}`，保证上层始终拿到结构化错误。
 */
export async function parseErrorResponse(response: Response): Promise<ApiError> {
  const fallbackCode = `HTTP_${response.status}`
  // 读取失败（如连接中断）时按状态码兜底，避免抛错掩盖原始失败
  const text = await response.text().catch(() => null)
  if (text === null) {
    return new ApiError({ code: fallbackCode, message: response.statusText, status: response.status })
  }

  if (text.trim() !== '') {
    try {
      const parsed = JSON.parse(text) as Partial<ApiErrorBody>
      const code = parsed?.error?.code
      const message = parsed?.error?.message
      if (typeof code === 'string' && code !== '') {
        return new ApiError({
          code,
          message: typeof message === 'string' ? message : '',
          status: response.status,
          details: parsed.error?.details,
        })
      }
    } catch {
      // 非 JSON：走下面的兜底
    }
  }

  return new ApiError({
    code: fallbackCode,
    message: response.statusText || '请求失败',
    status: response.status,
  })
}
