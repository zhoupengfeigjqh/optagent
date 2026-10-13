/**
 * 单元测试：下一步动作提示 store（007 修订 · Tail Protocol）。
 *
 * 修订后本层不再有拉取窗口（卡片随 `done` 直推），钉住四条剩余约束：
 * 会话选中即清空并**一次性恢复拉取**、恢复响应的**过期丢弃**、
 * done 直推的 `apply`、发起新一轮的 `reset`；再加一条"失败静默"。
 */
import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyNextSteps, type NextStepsApi } from '../api/next-steps'
import type { ThreadNextSteps } from '../api/threads'
import { createNextStepsStore, type NextStepsStore } from './useNextSteps'

const HIT: ThreadNextSteps = {
  message_id: 'm-1',
  actions: [{ prompt: '按交付日期梳理这批订单的风险', tools: [], guidance: '' }],
}

/**
 * 创建 store 并返回句柄。
 *
 * 初始 `activeThreadId` 为 `null`（与真实装配一致：App 恢复会话是**事后**写入 ref），
 * 测试经 `enter(threadId)` 模拟"选中 / 刷新恢复"——watch 由此触发。
 */
function setup() {
  const activeThreadId = ref<string | null>(null)
  const fetcher = vi.fn<(threadId: string) => Promise<ThreadNextSteps>>(async () => emptyNextSteps())
  const api: NextStepsApi = { fetch: (threadId: string) => fetcher(threadId) }
  const store: NextStepsStore = createNextStepsStore({ nextSteps: api, activeThreadId })
  return {
    activeThreadId,
    fetcher,
    store,
    /** 选中会话（触发 watch → 清空 + 恢复拉取） */
    enter(threadId: string): void {
      activeThreadId.value = threadId
    },
  }
}

/** 让在途微任务 / 微任务链落定（watch 回调与 restore 的首轮 await） */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('会话选中 → 一次性恢复拉取（修订 G3：刷新后卡片不消失）', () => {
  it('选中会话即拉取一次；拉到卡片写入 steps', async () => {
    const { enter, fetcher, store } = setup()
    fetcher.mockResolvedValueOnce(HIT)

    enter('th_1')
    expect(store.steps.value).toEqual(emptyNextSteps()) // 进入即先清空，不等响应
    await settle()

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('th_1')
    expect(store.steps.value).toEqual(HIT)
  })

  it('切换会话：立即清空 + 对新会话拉取一次（旧会话不再多发请求）', async () => {
    const { enter, fetcher, store } = setup()
    enter('th_1')
    await settle()
    expect(fetcher).toHaveBeenCalledTimes(1)

    enter('th_2')
    expect(store.steps.value).toEqual(emptyNextSteps())
    await settle()

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenLastCalledWith('th_2')
  })

  it('恢复拉到空形态（该会话最新一轮无卡片）→ steps 保持空（终态，不重试）', async () => {
    const { enter, fetcher, store } = setup()
    enter('th_1')
    await settle()

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(store.steps.value).toEqual(emptyNextSteps())
  })
})

describe('过期响应丢弃', () => {
  it('旧会话的恢复响应姗姗来迟 → 不写入新会话的 steps', async () => {
    const activeThreadId = ref<string | null>(null)
    const deferred: Array<(value: ThreadNextSteps) => void> = []
    const api: NextStepsApi = {
      fetch: () => new Promise<ThreadNextSteps>((resolve) => deferred.push(resolve)),
    }
    const store = createNextStepsStore({ nextSteps: api, activeThreadId })

    activeThreadId.value = 'th_1'
    await settle() // 第 1 次请求在途（th_1）
    activeThreadId.value = 'th_2' // 切走：th_1 的响应就此过期
    await settle()
    deferred[0]!(HIT) // 旧响应（含卡片）姗姗来迟
    await settle()

    expect(store.steps.value).toEqual(emptyNextSteps())
  })
})

describe('done 直推与新一轮清空', () => {
  it('apply 写入当轮卡片（无任何拉取、无任何窗口）', () => {
    const { fetcher, store } = setup()

    store.apply(HIT)

    expect(store.steps.value).toEqual(HIT)
    expect(fetcher).not.toHaveBeenCalled() // 直推路径不触发任何请求
  })

  it('reset 立即清空（onSend 发起新一轮时调用，与后端 clear 同刻）', () => {
    const { store } = setup()
    store.apply(HIT)

    store.reset()

    expect(store.steps.value).toEqual(emptyNextSteps())
  })

  it('发起新一轮（reset）不会触发恢复拉取（activeThreadId 未变）', async () => {
    const { enter, fetcher, store } = setup()
    enter('th_1')
    await settle()
    expect(fetcher).toHaveBeenCalledTimes(1)

    store.reset()
    await settle()

    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('失败静默', () => {
  it('恢复拉取失败 → 不抛错、不置错误态、`steps` 保持空形态', async () => {
    const { enter, fetcher, store } = setup()
    fetcher.mockRejectedValue(new Error('网络断了'))

    enter('th_1')
    await expect(settle()).resolves.toBeUndefined()
    expect(store.steps.value).toEqual(emptyNextSteps())
  })
})
