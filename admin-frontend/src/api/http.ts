
import { ADMIN_ERROR_CODES } from '../constants/error-messages'
import type { ApiErrorBody, ErrorInfo } from './types'

export const CLIENT_ERROR_CODE = {
  NETWORK: 'NETWORK_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
} as const

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

export type QueryValue = string | number | boolean | undefined | null

export interface RequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, QueryValue>
  signal?: AbortSignal
  headers?: Record<string, string>
}

export interface HttpClient {
  readonly baseUrl: string
  readonly fetchImpl: typeof fetch
  request<T>(path: string, options?: RequestOptions): Promise<T>
  get<T>(path: string, query?: Record<string, QueryValue>): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  put<T>(path: string, body?: unknown): Promise<T>
  del<T>(path: string): Promise<T>
  url(path: string, query?: Record<string, QueryValue>): string
}

export interface HttpClientOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** 401 响应时回调（统一处理会话失效：清登录态 + 跳登录页） */
  onUnauthorized?: (error: ApiError) => void
}

/** 解析默认 BaseURL（去掉结尾斜杠，避免出现 `//api`） */
export function resolveBaseUrl(): string {
  const configured = import.meta.env?.VITE_API_BASE_URL ?? ''
  return configured.replace(/\/+$/, '')
}

/**
 * 模块级 401 回调（供 `http` 单例使用；测试可给 `createHttpClient` 传 `onUnauthorized`）。
 * 由 `useAuthSession` 在模块加载时注册，实现「任何请求命中 401 → 清会话跳登录」的统一善后。
 */
let unauthorizedHandler: ((error: ApiError) => void) | null = null

export function setUnauthorizedHandler(handler: ((error: ApiError) => void) | null): void {
  unauthorizedHandler = handler
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const baseUrl = (options.baseUrl ?? resolveBaseUrl()).replace(/\/+$/, '')
  const fetchImpl: typeof fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const onUnauthorized = options.onUnauthorized

  function url(path: string, query?: Record<string, QueryValue>): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') continue
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
        init.body = body
      } else {
        mergedHeaders['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
    }
    if (Object.keys(mergedHeaders).length > 0) init.headers = mergedHeaders

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
      const error = await parseErrorResponse(response)
      if (response.status === 401) (onUnauthorized ?? unauthorizedHandler)?.(error)
      throw error
    }
    if (response.status === 204) return undefined as T

    const text = await response.text()
    if (text.trim() === '') return undefined as T

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
    del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  }
}

export async function parseErrorResponse(response: Response): Promise<ApiError> {
  // 裸 401（无 JSON 错误体）也归一到契约码，让文案映射到「登录状态已失效」，
  // 避免生成 `HTTP_401` 这种映射表里没有的漂移码。
  const fallbackCode =
    response.status === 401 ? ADMIN_ERROR_CODES.ADM_UNAUTHENTICATED : `HTTP_${response.status}`
  const text = await response.text().catch(() => null)
  if (text === null) {
    return new ApiError({
      code: fallbackCode,
      message: response.statusText,
      status: response.status,
    })
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

export const http = createHttpClient()
