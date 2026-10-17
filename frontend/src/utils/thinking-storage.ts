/**
 * 「思考模式」开关的 `sessionStorage` 读写（2026-10-16，自 `useChatStream.ts` 抽出）
 *
 * 抽出来的理由：三个函数是纯的"存储访问 + 容错"，与流式状态机无关（宪章原则二）。
 * 沿用既有口径：**存储不可用一律静默降级**——`sessionStorage` 在隐私模式、
 * 跨源 iframe、禁用 cookie 等情形会直接抛错，而"记住开关"是纯便利功能，
 * 不值得因此让整个聊天区报错（宪章原则九：能力不存在 ≠ 出错）。
 */
import { STORAGE_KEY_THINKING } from '../constants/limits'

/** 取 `sessionStorage`；不可用（服务端渲染 / 隐私模式 / 被禁用）时返回 `null`。 */
export function safeSessionStorage(): Storage | null {
  try {
    return typeof globalThis.sessionStorage === 'undefined' ? null : globalThis.sessionStorage
  } catch {
    return null
  }
}

/** 读开关：只把 `'1'` 认作开启，其余（含读取失败）一律关闭。 */
export function readStoredThinking(storage: Storage | null): boolean {
  try {
    return storage?.getItem(STORAGE_KEY_THINKING) === '1'
  } catch {
    return false
  }
}

/** 写开关；存储不可用时静默降级。 */
export function writeStoredThinking(storage: Storage | null, value: boolean): void {
  try {
    storage?.setItem(STORAGE_KEY_THINKING, value ? '1' : '0')
  } catch {
    // 存储不可用时静默降级
  }
}
