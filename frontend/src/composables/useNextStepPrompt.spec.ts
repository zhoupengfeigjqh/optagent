/**
 * 单元测试：下一步动作卡片的确认弹窗（2026-10-16，拆分产出）。
 *
 * 三条口径：三处不可用态**拒绝并且不发送**、"只有真发出去了才关弹窗"、
 * 发送中连点只发一次。三条都是"看起来能点、实际什么也没发生"的反面。
 */
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import type { AgentStarter } from '../api/types'
import { createToastStore } from './useToast'
import { useNextStepPrompt } from './useNextStepPrompt'

const CARD: AgentStarter = { prompt: '看看产能瓶颈', tools: [], guidance: 'ocr_image' }

function setup(options: { streaming?: boolean; agent?: boolean } = {}) {
  const streaming = ref<unknown | null>(options.streaming === true ? { phase: 'streaming' } : null)
  const currentAgent = ref<{ agent_name: string } | null>(
    options.agent === false ? null : { agent_name: 'demo' },
  )
  const send = vi.fn().mockResolvedValue(true)
  const toast = createToastStore()
  const prompt = useNextStepPrompt({ streaming, currentAgent, send, toast })
  return { prompt, streaming, currentAgent, send, toast }
}

describe('useNextStepPrompt —— 点卡片（2026-10-16）', () => {
  it('正常：只打开确认弹窗，不发消息', () => {
    const { prompt, send } = setup()

    prompt.onPickNextStep(CARD)

    expect(prompt.pendingSuggestion.value).toEqual(CARD)
    expect(send).not.toHaveBeenCalled()
  })

  it('本轮进行中：不响应（避免在别人的通道上排队发送）', () => {
    const { prompt, send } = setup({ streaming: true })

    prompt.onPickNextStep(CARD)

    expect(prompt.pendingSuggestion.value).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it('未选数字人：明确提示且不打开弹窗', () => {
    const { prompt, send, toast } = setup({ agent: false })

    prompt.onPickNextStep(CARD)

    expect(prompt.pendingSuggestion.value).toBeNull()
    expect(send).not.toHaveBeenCalled()
    expect(toast.items.value[0]?.text).toBe('请先选择数字人再发送')
  })

  it('取消：关掉弹窗，不发送', () => {
    const { prompt, send } = setup()
    prompt.onPickNextStep(CARD)

    prompt.onCancelSuggestion()

    expect(prompt.pendingSuggestion.value).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('useNextStepPrompt —— 确认发送（2026-10-16）', () => {
  it('确认：走唯一发送链路，载荷只有提示词与隐藏引导，且不等本轮结束', async () => {
    const { prompt, send } = setup()
    prompt.onPickNextStep(CARD)

    await prompt.onConfirmSuggestion()

    expect(send).toHaveBeenCalledWith(
      { content: '看看产能瓶颈', attachments: [], guidance: 'ocr_image' },
      { settleBeforeReturn: false },
    )
    expect(prompt.pendingSuggestion.value).toBeNull()
  })

  it('没有待确认卡片：确认是空操作（不发请求）', async () => {
    const { prompt, send } = setup()

    await prompt.onConfirmSuggestion()

    expect(send).not.toHaveBeenCalled()
  })

  it('被本地拦下（返回 false）：保留提示词，用户可重试或取消', async () => {
    const { prompt, send } = setup()
    send.mockResolvedValue(false)
    prompt.onPickNextStep(CARD)

    await prompt.onConfirmSuggestion()

    expect(prompt.pendingSuggestion.value).toEqual(CARD)
    expect(prompt.suggestionSending.value).toBe(false)
  })

  it('发送中连点：只发一次，且发送中标志已置位', async () => {
    const { prompt, send } = setup()
    let release: () => void = () => undefined
    send.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true)
        }),
    )
    prompt.onPickNextStep(CARD)

    const first = prompt.onConfirmSuggestion()
    expect(prompt.suggestionSending.value).toBe(true)
    await prompt.onConfirmSuggestion() // 第二次：仍在发送中

    expect(send).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(prompt.suggestionSending.value).toBe(false)
  })

  it('发送抛错：标志位照样复位（否则弹窗按钮会永久禁用）', async () => {
    const { prompt, send } = setup()
    send.mockRejectedValue(new Error('boom'))
    prompt.onPickNextStep(CARD)

    await expect(prompt.onConfirmSuggestion()).rejects.toThrow('boom')

    expect(prompt.suggestionSending.value).toBe(false)
  })
})
