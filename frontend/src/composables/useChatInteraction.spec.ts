/**
 * 单元测试：HITL 装配（自 `useChatPanel` 拆分后仍须守住的行为）。
 *
 * 守四件事：
 * 1. 断连恢复：线程详情带等待中的快照 → 重建弹窗（`restoreInteraction` 恰好一次）；
 * 2. 提交成功（`close: true`）→ 不写逐字段错误；
 * 3. 提交失败（`close: false` + `message`）→ 错误回写弹窗，下一次提交前清空；
 * 4. 拒绝：清空错误并转发 `rejectInteraction`。
 */
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { useChatInteraction } from './useChatInteraction'

function makeDeps() {
  return {
    chat: {
      pendingInteraction: ref<{ call_id: string } | null>(null),
      restoreInteraction: vi.fn(),
      submitInteraction: vi.fn(async () => ({ close: true, message: '' })),
      rejectInteraction: vi.fn(async () => undefined),
    },
    threads: { pendingInteraction: ref<{ call_id: string } | null>(null) },
  }
}

type Deps = ReturnType<typeof makeDeps>

function mountHitl(deps: Deps) {
  let hitl!: ReturnType<typeof useChatInteraction>
  const Harness = defineComponent({
    setup() {
      hitl = useChatInteraction(
        deps.chat as unknown as Parameters<typeof useChatInteraction>[0],
        deps.threads as unknown as Parameters<typeof useChatInteraction>[1],
      )
      return () => h('div')
    },
  })
  mount(Harness)
  return hitl
}

const flush = (): Promise<void> => Promise.resolve().then(() => Promise.resolve())

describe('useChatInteraction —— 断连恢复', () => {
  it('线程详情出现等待中的快照 → 重建弹窗', async () => {
    const deps = makeDeps()
    mountHitl(deps)

    deps.threads.pendingInteraction.value = { call_id: 'call_1' }
    await flush()

    expect(deps.chat.restoreInteraction).toHaveBeenCalledTimes(1)
    expect(deps.chat.restoreInteraction).toHaveBeenCalledWith({ call_id: 'call_1' })
  })

  it('无快照（普通线程详情）→ 不触发重建', async () => {
    const deps = makeDeps()
    mountHitl(deps)

    deps.threads.pendingInteraction.value = null
    await flush()

    expect(deps.chat.restoreInteraction).not.toHaveBeenCalled()
  })
})

describe('useChatInteraction —— 提交与拒绝', () => {
  it('渲染源就是 chat 里的待确认请求', () => {
    const deps = makeDeps()
    deps.chat.pendingInteraction.value = { call_id: 'call_1' }
    const hitl = mountHitl(deps)

    expect(hitl.pendingInteraction.value).toEqual({ call_id: 'call_1' })
    expect(hitl.interactionError.value).toBe('')
  })

  it('提交成功（close: true）→ 不写错误', async () => {
    const deps = makeDeps()
    const hitl = mountHitl(deps)

    await hitl.onSubmitInteraction({ approved: true })

    expect(deps.chat.submitInteraction).toHaveBeenCalledWith({ approved: true })
    expect(hitl.interactionError.value).toBe('')
  })

  it('服务端终验失败 → 逐字段错误回写弹窗，下次提交前清空', async () => {
    const deps = makeDeps()
    deps.chat.submitInteraction.mockResolvedValueOnce({ close: false, message: '数量必须为正数' })
    const hitl = mountHitl(deps)

    await hitl.onSubmitInteraction({ qty: -1 })
    expect(hitl.interactionError.value).toBe('数量必须为正数')

    await hitl.onSubmitInteraction({ qty: 1 })
    expect(hitl.interactionError.value).toBe('')
  })

  it('拒绝 → 清空错误并转发 rejectInteraction', async () => {
    const deps = makeDeps()
    deps.chat.submitInteraction.mockResolvedValueOnce({ close: false, message: '出错了' })
    const hitl = mountHitl(deps)
    await hitl.onSubmitInteraction({})

    hitl.onRejectInteraction()
    await flush()

    expect(hitl.interactionError.value).toBe('')
    expect(deps.chat.rejectInteraction).toHaveBeenCalledTimes(1)
  })
})
