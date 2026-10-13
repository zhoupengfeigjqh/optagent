/**
 * 组件测试：卡片在气泡内的位置与归属（007）。
 *
 * 两条都是"位置/归属"这类只有渲染出来才能验证的事：
 * - 卡片容器在**正文之后**（FR-010，与工具记录、视图入口同层的侧车位置）；
 * - 只有 id 命中 `message_id` 的那条消息才渲染（FR-015：历史轮不展示）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Message } from '../../api/types'
import type { ThreadNextSteps } from '../../api/threads'
import { NEXT_STEPS_GUIDE_TEXT } from '../../utils/next-steps'
import MessageBubble from './MessageBubble.vue'

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm-2',
    role: 'assistant',
    content: '这批订单共 12 条。',
    ts: '2026-10-12T08:00:00.000Z',
    feedback: null,
    status: 'completed',
    ...overrides,
  }
}

function nextSteps(overrides: Partial<ThreadNextSteps> = {}): ThreadNextSteps {
  return {
    message_id: 'm-2',
    actions: [{ prompt: '按交付日期梳理订单风险', tools: [], guidance: '' }],
    ...overrides,
  }
}

describe('MessageBubble —— 下一步动作卡片（007）', () => {
  it('卡片容器渲染在正文容器**之后**（不插入正文中间）', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: message(), nextSteps: nextSteps() },
    })

    const content = wrapper.find('.message-content').element
    const cards = wrapper.find('.next-steps').element

    // DOCUMENT_POSITION_FOLLOWING = 4：cards 在 content 之后
    expect(content.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('id 不匹配的消息（历史轮）不渲染卡片', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: message({ id: 'm-1' }), nextSteps: nextSteps({ message_id: 'm-2' }) },
    })

    expect(wrapper.find('.next-steps').exists()).toBe(false)
  })

  it('未传 `nextSteps`（会话无建议）时正文与工具记录区照常渲染，无任何卡片痕迹', () => {
    const wrapper = mount(MessageBubble, { props: { message: message() } })

    expect(wrapper.text()).toContain('这批订单共 12 条。')
    expect(wrapper.find('.next-steps').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(NEXT_STEPS_GUIDE_TEXT)
  })

  it('点选卡片 → 向上抛 `send-suggestion`（发送由装配层决定）', async () => {
    const wrapper = mount(MessageBubble, {
      props: { message: message(), nextSteps: nextSteps() },
    })

    await wrapper.find('button').trigger('click')

    const emitted = wrapper.emitted('send-suggestion')
    expect(emitted).toHaveLength(1)
    expect(emitted?.[0]?.[0]).toMatchObject({ prompt: '按交付日期梳理订单风险' })
  })
})
