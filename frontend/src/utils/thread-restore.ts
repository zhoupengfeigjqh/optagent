
import { STORAGE_KEY_THREAD } from '../constants/limits'

export const THREAD_QUERY_KEY = 'thread'

/** 最小 URL 视图（避免函数依赖全局 `location`，便于测试）。 */
export interface UrlLike {
  pathname: string
  search: string
  hash: string
}

export function readThreadFromSearch(search: string): string | null {
  try {
    const value = new URLSearchParams(search).get(THREAD_QUERY_KEY)
    return value !== null && value.trim() !== '' ? value : null
  } catch {
    return null
  }
}

export function withThreadParam(search: string, threadId: string | null): string {
  const params = new URLSearchParams(search)
  if (threadId !== null && threadId !== '') {
    params.set(THREAD_QUERY_KEY, threadId)
  } else {
    params.delete(THREAD_QUERY_KEY)
  }
  const next = params.toString()
  return next === '' ? '' : `?${next}`
}

export function writeThreadToUrl(
  threadId: string | null,
  url: UrlLike,
  replace: (next: string) => void,
): void {
  const search = withThreadParam(url.search, threadId)
  replace(`${url.pathname}${search}${url.hash}`)
}

/** 从本地存储读出上次的会话 id（不可用/无值时返回 null）。 */
export function readStoredThread(storage: Storage | null): string | null {
  try {
    const value = storage?.getItem(STORAGE_KEY_THREAD)
    return value !== null && value !== undefined && value !== '' ? value : null
  } catch {
    return null
  }
}

/** 写入（或清除）本地存储的会话 id；存储不可用时静默跳过。 */
export function writeStoredThread(storage: Storage | null, threadId: string | null): void {
  try {
    if (threadId === null || threadId === '') storage?.removeItem(STORAGE_KEY_THREAD)
    else storage?.setItem(STORAGE_KEY_THREAD, threadId)
  } catch {
    /* 隐私模式/配额满：恢复能力降级，不影响主流程 */
  }
}
