/**
 * 单元测试：异步状态机（loading / error / data）
 *
 * 守住三条：
 * ① "加载中"与"空结果"是**可区分**的两个状态；
 * ② 错误经 `toErrorInfo` 归一，可交给文案映射按码分派；
 * ③ 并发请求只保留**最后一次**的结果（慢响应不覆盖新响应）。
 */
import { describe, expect, it, vi } from 'vitest'
import { useAsync } from './useAsync'

describe('useAsync', () => {
  it('初始为空闲态', () => {
    const state = useAsync(async () => 1)
    expect(state.loading.value).toBe(false)
    expect(state.loaded.value).toBe(false)
    expect(state.data.value).toBeNull()
    expect(state.error.value).toBeNull()
  })

  it('成功后写入 data 并标记 loaded', async () => {
    const state = useAsync(async () => ({ items: [1, 2] }))
    await expect(state.run()).resolves.toBe(true)
    expect(state.data.value).toEqual({ items: [1, 2] })
    expect(state.loaded.value).toBe(true)
    expect(state.error.value).toBeNull()
    expect(state.loading.value).toBe(false)
  })

  it('失败：run 返回 false、错误被归一为 ErrorInfo（带 code）', async () => {
    const state = useAsync(async () => {
      throw { code: 'ADM_STORAGE_UNAVAILABLE', message: 'x' }
    })
    await expect(state.run()).resolves.toBe(false)
    expect(state.error.value).toEqual({ code: 'ADM_STORAGE_UNAVAILABLE', message: 'x' })
    expect(state.data.value).toBeNull()
  })

  it('失败后重试成功会清空错误（不残留旧错误）', async () => {
    let fail = true
    const state = useAsync(async () => {
      if (fail) throw new Error('boom')
      return 'ok'
    })

    await state.run()
    expect(state.error.value?.code).toBe('NETWORK_ERROR')

    fail = false
    await state.run()
    expect(state.error.value).toBeNull()
    expect(state.data.value).toBe('ok')
  })

  it('"空结果"与"加载失败"互斥：空数组是成功的 data，不是错误', async () => {
    const state = useAsync(async () => [])
    await state.run()
    expect(state.data.value).toEqual([])
    expect(state.error.value).toBeNull()
    expect(state.loaded.value).toBe(true)
  })

  it('immediate: true 时创建即执行一次', async () => {
    const loader = vi.fn().mockResolvedValue('x')
    useAsync(loader, { immediate: true })
    await Promise.resolve()
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('并发：只保留最后一次请求的结果（慢响应不覆盖新响应）', async () => {
    let resolveSlow: ((value: string) => void) | undefined
    const slow = new Promise<string>((resolve) => {
      resolveSlow = resolve
    })
    let call = 0
    const state = useAsync(async () => {
      call += 1
      return call === 1 ? slow : 'fast'
    })

    const first = state.run()
    const second = state.run()
    await second
    expect(state.data.value).toBe('fast')

    // 迟到的第一次请求不得覆盖
    resolveSlow?.('slow')
    await first
    expect(state.data.value).toBe('fast')
  })

  it('reset 清空全部状态（切换实体时避免残留上一个实体的内容）', async () => {
    const state = useAsync(async () => 'x')
    await state.run()
    state.reset()
    expect(state.data.value).toBeNull()
    expect(state.loaded.value).toBe(false)
    expect(state.error.value).toBeNull()
    expect(state.loading.value).toBe(false)
  })

  it('loading 在请求期间为 true，结束后复位', async () => {
    let release: (() => void) | undefined
    const state = useAsync(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('done')
        }),
    )

    const promise = state.run()
    expect(state.loading.value).toBe(true)
    release?.()
    await promise
    expect(state.loading.value).toBe(false)
  })
})
