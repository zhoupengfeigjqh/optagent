/**
 * 轻量提示队列（D14）
 *
 * 约束：容器 `aria-live="polite"`、同一时刻最多 3 条、4s 自动消失、可手动关闭。
 * 提示仅承载"失败原因 / 需要用户知晓的短信息"，**不承载流程阻断**（阻断用 `ErrorNotice`）。
 */

import { ref, type Ref } from 'vue'

import { TOAST_DURATION_MS, TOAST_MAX_VISIBLE } from '../constants/limits'
import { useSession } from './useAppSession'

/** 提示级别（决定语义色，颜色由 CSS 变量表达）。 */
export type ToastLevel = 'info' | 'success' | 'error'

/** 提示上的可选操作（如"重试"）。 */
export interface ToastAction {
  label: string
  run: () => void
}

/** 单条提示。 */
export interface ToastItem {
  id: string
  level: ToastLevel
  text: string
  action: ToastAction | null
}

/** 构造参数（测试可注入时长与容量）。 */
export interface ToastOptions {
  /** 自动消失时长（毫秒），默认 4000 */
  durationMs?: number
  /** 同时可见上限，默认 3 */
  maxVisible?: number
}

/** 提示 composable 契约。 */
export interface ToastStore {
  items: Readonly<Ref<ToastItem[]>>
  /** 入队一条提示，返回其 id */
  push(level: ToastLevel, text: string, action?: ToastAction | null): string
  /** 手动关闭 */
  dismiss(id: string): void
  /** 执行该条的操作并关闭它 */
  runAction(id: string): void
  /** 清空全部提示 */
  clear(): void
}

/** 创建提示队列。 */
export function createToastStore(options: ToastOptions = {}): ToastStore {
  const durationMs = options.durationMs ?? TOAST_DURATION_MS
  const maxVisible = options.maxVisible ?? TOAST_MAX_VISIBLE

  const items = ref<ToastItem[]>([])
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let sequence = 0

  function clearTimer(id: string): void {
    const timer = timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(id)
    }
  }

  function dismiss(id: string): void {
    clearTimer(id)
    items.value = items.value.filter((item) => item.id !== id)
  }

  function push(level: ToastLevel, text: string, action: ToastAction | null = null): string {
    sequence += 1
    const id = `toast-${sequence}`

    items.value = [...items.value, { id, level, text, action }]

    // 超出可见上限：移除最早的一条（连同其定时器）
    while (items.value.length > maxVisible) {
      const oldest = items.value[0]
      clearTimer(oldest.id)
      items.value = items.value.slice(1)
    }

    timers.set(
      id,
      setTimeout(() => dismiss(id), durationMs),
    )
    return id
  }

  function runAction(id: string): void {
    const item = items.value.find((candidate) => candidate.id === id)
    const action = item?.action
    if (!action) {
      return
    }
    // 先关闭再执行，避免操作抛错时残留提示
    dismiss(id)
    action.run()
  }

  function clear(): void {
    for (const id of [...timers.keys()]) {
      clearTimer(id)
    }
    items.value = []
  }

  return { items, push, dismiss, runAction, clear }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useToast(): ToastStore {
  return useSession().toast
}
