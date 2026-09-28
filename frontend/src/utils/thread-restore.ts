/**
 * 会话恢复（002 特性）：刷新后回到原会话
 *
 * 为什么必须做：工具记录落盘后，"刷新可见"这一诉求还差最后一环——
 * `activeThreadId` 原本只在内存里，刷新即归零，中栏回到空态，
 * 用户得手动点左侧历史才能看到工具卡片，观感上仍是"刷新就没了"。
 *
 * 恢复来源（URL 优先，`sessionStorage` 兜底）：
 * - URL `?thread=<id>`：可分享、支持浏览器前进后退
 * - `sessionStorage`：URL 被手工清掉时仍能恢复
 *
 * 全部为**纯函数**（URL 与 history 由调用方注入），便于单测与沙箱降级。
 */

import { STORAGE_KEY_THREAD } from '../constants/limits'

/** URL query 中承载会话 id 的参数名。 */
export const THREAD_QUERY_KEY = 'thread'

/** 最小 URL 视图（避免函数依赖全局 `location`，便于测试）。 */
export interface UrlLike {
  pathname: string
  search: string
  hash: string
}

/** 从 search 串中读出会话 id（缺失/空白一律视为无）。 */
export function readThreadFromSearch(search: string): string | null {
  try {
    const value = new URLSearchParams(search).get(THREAD_QUERY_KEY)
    return value !== null && value.trim() !== '' ? value : null
  } catch {
    return null
  }
}

/** 计算带（或去掉）`thread` 参数的新 search 串；无参数时返回空串。 */
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

/**
 * 把会话 id 同步到地址栏。
 *
 * 用 `history.replaceState` 而非 `pushState`：会话切换/新会话不是"导航"，
 * 不该把浏览器后退键变成"逐个回退历史会话"。
 */
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
