
import { ref, type Ref } from 'vue'

import { TOAST_DURATION_MS, TOAST_MAX_VISIBLE } from '../constants/limits'
import { useSession } from './useAppSession'

export type ToastLevel = 'info' | 'success' | 'error'

export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastItem {
  id: string
  level: ToastLevel
  text: string
  action: ToastAction | null
}

export interface ToastOptions {
  /** 自动消失时长（毫秒），默认 4000 */
  durationMs?: number
  /** 同时可见上限，默认 3 */
  maxVisible?: number
}

export interface ToastStore {
  items: Readonly<Ref<ToastItem[]>>
  push(level: ToastLevel, text: string, action?: ToastAction | null): string
  dismiss(id: string): void
  runAction(id: string): void
  clear(): void
}

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

export function useToast(): ToastStore {
  return useSession().toast
}
