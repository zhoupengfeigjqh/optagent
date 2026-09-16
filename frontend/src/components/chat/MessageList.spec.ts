/**
 * 组件测试：消息列表的乐观用户气泡（2026-09-16 十七次调整）。
 *
 * 回归的 bug：用户消息只在历史刷新（流完成后）才渲染，发送后要到 AI 答完才看到
 * 自己的消息。修复后 `pendingUser` 应在历史消息**之后**、流式气泡**之前**渲染为
 * 用户气泡；`null` 时（无进行中轮次）不渲染。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { Message } from '../../api/types'
import { RUN_PHASE } from '../../constants/events'
import MessageList from './MessageList.vue'

const STREAMING_VIEW = {
  phase: RUN_PHASE.STREAMING,
  text: '',
  thinking: '',
  toolCalls: [],
  error: null,
  agentName: 'demo',
}

const HISTORICAL: Message[] = [
  { id: 'm_1', role: 'user', content: '上一条消息', ts: '2026-09-16T10:00:00Z', feedback: null },
]

describe('MessageList —— 乐观用户气泡（十七次调整）', () => {
  it('pendingUser 渲染为用户气泡（"我" + 正文 + 引用），位于历史之后、流式之前', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: HISTORICAL,
        streaming: STREAMING_VIEW,
        pendingUser: {
          content: '帮我看看这份计划',
          attachments: [{ dir: '临时空间', filename: '计划.csv' }],
        },
      },
    })

    const text = wrapper.text()
    expect(text).toContain('上一条消息')
    expect(text).toContain('帮我看看这份计划')
    expect(text).toContain('计划.csv')

    // 顺序：历史 → 乐观用户气泡 → 流式气泡（断言"我"标签的相对位置）
    const plain = text.replace(/\s+/g, '')
    expect(plain.indexOf('上一条消息')).toBeLessThan(plain.indexOf('帮我看看这份计划'))
  })

  it('pendingUser 为 null 时不渲染乐观气泡（用户气泡只有历史里那一条，无重复、无残留）', () => {
    const wrapper = mount(MessageList, {
      props: { messages: HISTORICAL, streaming: STREAMING_VIEW, pendingUser: null },
    })

    const userBubbles = wrapper
      .findAll('.message-bubble')
      .filter((bubble) => bubble.classes().includes('message-bubble--user'))
    // HISTORICAL 里本就有一条用户消息—— optimistic 气泡不应让它变多
    expect(userBubbles).toHaveLength(1)
    expect(userBubbles[0]!.text()).toContain('上一条消息')
  })

  it('仅乐观气泡在途（首轮、历史为空）：不落入空态占位，正常渲染', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [],
        streaming: STREAMING_VIEW,
        pendingUser: { content: '第一条消息', attachments: [] },
      },
    })

    expect(wrapper.find('.empty-state').exists()).toBe(false)
    expect(wrapper.text()).toContain('第一条消息')
  })
})
