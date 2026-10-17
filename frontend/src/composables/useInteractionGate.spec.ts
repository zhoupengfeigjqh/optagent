/**
 * 单元测试：HITL 工具调用确认闸门（2026-10-16，拆分产出）。
 *
 * 最要紧的一条是**终验失败时弹窗必须保持打开**（`close: false` + 逐字段错误），
 * 否则用户会看到"点了确认、弹窗没了、参数却没提交成功"——服务端已经把错在哪说清楚了，
 * 关掉弹窗等于把这份信息扔掉。
 */
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import type { InteractionSnapshot } from '../api/types'
import { createToastStore } from './useToast'
import { useInteractionGate } from './useInteractionGate'

function snapshot(overrides: Partial<InteractionSnapshot> = {}): InteractionSnapshot {
  return {
    interaction_id: 'it_1',
    call_id: 'c_1',
    tool_name: 'ocr_image',
    title: '确认调用 ocr_image',
    schema: {},
    proposed_args: {},
    required: [],
    timeout_seconds: 120,
    remaining_seconds: 120,
    ...overrides,
  }
}

function setup(options: { threadId?: string | null; withSubmit?: boolean } = {}) {
  const pendingInteraction = ref<InteractionSnapshot | null>(null)
  const activeThreadId = ref<string | null>(options.threadId === undefined ? 'th_1' : options.threadId)
  const submit = vi.fn().mockResolvedValue({ accepted: true })
  const toast = createToastStore()
  const gate = useInteractionGate({
    pendingInteraction,
    activeThreadId,
    submit: options.withSubmit === false ? undefined : submit,
    toast,
  })
  return { gate, pendingInteraction, activeThreadId, submit, toast }
}

describe('useInteractionGate —— 重建与关闭（2026-10-16）', () => {
  it('断连恢复：没有弹窗时用快照重建', () => {
    const { gate, pendingInteraction } = setup()

    gate.restoreInteraction(snapshot())

    expect(pendingInteraction.value?.interaction_id).toBe('it_1')
  })

  it('已有弹窗时不被快照覆盖（用户可能正在填）', () => {
    const { gate, pendingInteraction } = setup()
    pendingInteraction.value = snapshot({ interaction_id: 'it_now' })

    gate.restoreInteraction(snapshot({ interaction_id: 'it_old' }))

    expect(pendingInteraction.value?.interaction_id).toBe('it_now')
  })

  it('无等待中的确认 / 无会话 / 未装配提交能力：一律直接关闭且不发请求', async () => {
    const noPending = setup()
    await expect(noPending.gate.submitInteraction({})).resolves.toEqual({ close: true })
    expect(noPending.submit).not.toHaveBeenCalled()

    const noThread = setup({ threadId: null })
    noThread.pendingInteraction.value = snapshot()
    await expect(noThread.gate.submitInteraction({})).resolves.toEqual({ close: true })
    expect(noThread.submit).not.toHaveBeenCalled()

    const notWired = setup({ withSubmit: false })
    notWired.pendingInteraction.value = snapshot()
    await expect(notWired.gate.submitInteraction({})).resolves.toEqual({ close: true })
  })
})

describe('useInteractionGate —— 提交（2026-10-16）', () => {
  it('成功：带上 interaction_id 与动作提交，随后关闭弹窗', async () => {
    const { gate, pendingInteraction, submit } = setup()
    pendingInteraction.value = snapshot()

    const result = await gate.submitInteraction({ 文件: 'a.png' })

    expect(submit).toHaveBeenCalledWith('th_1', {
      interaction_id: 'it_1',
      action: 'submit',
      args: { 文件: 'a.png' },
    })
    expect(result).toEqual({ close: true })
    expect(pendingInteraction.value).toBeNull()
  })

  it('服务端终验失败：弹窗保持打开，逐字段错误回传（不关闭、不吞错）', async () => {
    const { gate, pendingInteraction, submit } = setup()
    pendingInteraction.value = snapshot()
    submit.mockRejectedValue({ code: 'SCHEMA_VALIDATION_FAILED', message: '文件：必填' })

    const result = await gate.submitInteraction({})

    expect(result).toEqual({ close: false, message: '文件：必填' })
    expect(pendingInteraction.value?.interaction_id).toBe('it_1')
  })

  it('终验失败但服务端没给 message：兜底一句可读文案（不许空着弹窗）', async () => {
    const { gate, pendingInteraction, submit } = setup()
    pendingInteraction.value = snapshot()
    submit.mockRejectedValue({ code: 'VALIDATION_FAILED', message: '' })

    const result = await gate.submitInteraction({})

    expect(result.close).toBe(false)
    expect(result.message).toBeTruthy()
  })

  it('其他失败（超时 / 已被处理）：提示并关闭弹窗', async () => {
    const { gate, pendingInteraction, submit, toast } = setup()
    pendingInteraction.value = snapshot()
    submit.mockRejectedValue({ code: 'INTERACTION_EXPIRED', message: '已超时' })

    const result = await gate.submitInteraction({})

    expect(result).toEqual({ close: true })
    expect(pendingInteraction.value).toBeNull()
    expect(toast.items.value).toHaveLength(1)
    expect(toast.items.value[0].level).toBe('error')
  })
})

describe('useInteractionGate —— 拒绝（2026-10-16）', () => {
  it('拒绝：先关弹窗再发请求（后端把拒绝作为工具结果交给模型收尾）', async () => {
    const { gate, pendingInteraction, submit } = setup()
    pendingInteraction.value = snapshot()

    await gate.rejectInteraction()

    expect(submit).toHaveBeenCalledWith('th_1', { interaction_id: 'it_1', action: 'reject' })
    expect(submit.mock.calls[0][1]).not.toHaveProperty('args')
    expect(pendingInteraction.value).toBeNull()
  })

  it('无等待中的确认：不切状态也不发请求', async () => {
    const { gate, pendingInteraction, submit } = setup()

    await gate.rejectInteraction()

    expect(submit).not.toHaveBeenCalled()
    expect(pendingInteraction.value).toBeNull()
  })

  it('拒绝失败（已超时 / 已被处理）：不影响关闭，提示即可', async () => {
    const { gate, pendingInteraction, submit, toast } = setup()
    pendingInteraction.value = snapshot()
    submit.mockRejectedValue({ code: 'INTERACTION_EXPIRED', message: '已超时' })

    await gate.rejectInteraction()

    expect(pendingInteraction.value).toBeNull()
    expect(toast.items.value).toHaveLength(1)
  })
})
