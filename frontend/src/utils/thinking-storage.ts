import { STORAGE_KEY_THINKING } from '../constants/limits'

/** 取 `sessionStorage`；不可用（服务端渲染 / 隐私模式 / 被禁用）时返回 `null`。 */
export function safeSessionStorage(): Storage | null {
  try {
    return typeof globalThis.sessionStorage === 'undefined' ? null : globalThis.sessionStorage
  } catch {
    return null
  }
}

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
