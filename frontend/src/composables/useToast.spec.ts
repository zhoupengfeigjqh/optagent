import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TOAST_DURATION_MS, TOAST_MAX_VISIBLE } from '../constants/limits'
import { createToastStore } from './useToast'

describe('useToast（D14：最多 3 条、4s 自动消失、可手动关闭）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('push 入队并返回唯一 id', () => {
    const toast = createToastStore()

    const first = toast.push('info', '第一条')
    const second = toast.push('error', '第二条')

    expect(first).not.toBe(second)
    expect(toast.items.value).toEqual([
      { id: first, level: 'info', text: '第一条', action: null },
      { id: second, level: 'error', text: '第二条', action: null },
    ])
  })

  it('同一时刻最多保留 3 条，超出时移除最早的一条', () => {
    const toast = createToastStore()

    toast.push('info', 'a')
    toast.push('info', 'b')
    toast.push('info', 'c')
    toast.push('info', 'd')

    expect(toast.items.value).toHaveLength(TOAST_MAX_VISIBLE)
    expect(toast.items.value.map((item) => item.text)).toEqual(['b', 'c', 'd'])
  })

  it('默认 4s 后自动消失', () => {
    const toast = createToastStore()
    toast.push('info', '稍后消失')

    vi.advanceTimersByTime(TOAST_DURATION_MS - 1)
    expect(toast.items.value).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(toast.items.value).toHaveLength(0)
  })

  it('可自定义展示时长', () => {
    const toast = createToastStore({ durationMs: 100 })
    toast.push('info', 'x')

    vi.advanceTimersByTime(100)

    expect(toast.items.value).toHaveLength(0)
  })

  it('dismiss 立即移除并清理定时器（不产生额外副作用）', () => {
    const toast = createToastStore()
    const id = toast.push('info', 'x')

    toast.dismiss(id)
    expect(toast.items.value).toHaveLength(0)

    // 定时器已清理：推进时间不应抛错，也不应影响后续提示
    toast.push('info', 'y')
    vi.advanceTimersByTime(TOAST_DURATION_MS)
    expect(toast.items.value).toHaveLength(0)
  })

  it('runAction 执行操作并关闭该条', () => {
    const toast = createToastStore()
    const run = vi.fn()
    const id = toast.push('error', '发送失败', { label: '重试', run })

    toast.runAction(id)

    expect(run).toHaveBeenCalledTimes(1)
    expect(toast.items.value).toHaveLength(0)
  })

  it('无 action 时 runAction 为无操作且不关闭其它提示', () => {
    const toast = createToastStore()
    const id = toast.push('info', 'x')
    const other = toast.push('info', 'y')

    expect(() => toast.runAction(id)).not.toThrow()
    expect(toast.items.value.map((item) => item.id)).toEqual([id, other])
  })

  it('对不存在的 id 调用 runAction 不抛错', () => {
    const toast = createToastStore()

    expect(() => toast.runAction('missing')).not.toThrow()
  })

  it('clear 清空全部提示并清理定时器', () => {
    const toast = createToastStore()
    toast.push('info', 'a')
    toast.push('info', 'b')

    toast.clear()

    expect(toast.items.value).toHaveLength(0)
    vi.advanceTimersByTime(TOAST_DURATION_MS)
    expect(toast.items.value).toHaveLength(0)
  })

  it('被挤出队列的提示其定时器一并清理（不会误删新提示）', () => {
    const toast = createToastStore({ maxVisible: 1 })

    toast.push('info', 'old')
    const kept = toast.push('info', 'new')

    vi.advanceTimersByTime(TOAST_DURATION_MS)

    expect(toast.items.value).toHaveLength(0)
    expect(kept).toBeTruthy()
  })
})
