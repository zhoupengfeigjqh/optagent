/**
 * 组件测试：渲染段（A-lite，2026-11-16）的 DOM 顺序
 *
 * 需求：流式轮按「文字 → 工具 → 文字」的时间线渲染；历史消息没有段序（`history.jsonl`
 * 只存整段 `content`），仍按旧顺序「工具在上、正文在下」。
 *
 * 断言方式是比对渲染后的 HTML 里各片段出现的先后，而不是找"第几个子节点"——
 * 卡片内部结构可能变化，但"谁在谁前面"正是这次改动的全部意义。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { Message, ToolCallRecord } from '../../api/types'
import MessageBubble from './MessageBubble.vue'

function message(over: Partial<Message> = {}): Message {
  return {
    id: 'm_1',
    role: 'assistant',
    content: '',
    ts: '2026-11-16T08:00:00.000Z',
    feedback: null,
    ...over,
  }
}

function toolRecord(over: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    call_id: 'c1',
    name: 'fresh__fresh_order_parse',
    label: '生鲜订单解析',
    status: 'success',
    started_at: '2026-11-16T08:00:00.000Z',
    ...over,
  }
}

const order = (html: string, ...needles: string[]): number[] => needles.map((n) => html.indexOf(n))

describe('MessageBubble —— 渲染段顺序（A-lite）', () => {
  it('流式轮：文字 → 工具卡片 → 文字，按事件到达顺序交错', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: message({ content: '我先读一下技能。解析完成，共 3 行。' }),
        streaming: {
          phase: 'streaming' as const,
          text: '我先读一下技能。解析完成，共 3 行。',
          thinking: '',
          toolCalls: [
            { call_id: 'c1', name: 'fresh__fresh_order_parse', label: '生鲜订单解析', status: 'success' as const },
          ],
          stalled: false,
          segments: [
            { kind: 'text' as const, text: '我先读一下技能。' },
            {
              kind: 'tool' as const,
              call: { call_id: 'c1', name: 'fresh__fresh_order_parse', label: '生鲜订单解析', status: 'success' as const },
            },
            { kind: 'text' as const, text: '解析完成，共 3 行。' },
          ],
          error: null,
          agentName: null,
        },
      },
    })

    const [first, tool, second] = order(
      wrapper.html(),
      '我先读一下技能。',
      '生鲜订单解析',
      '解析完成，共 3 行。',
    )

    expect(first).toBeGreaterThanOrEqual(0)
    expect(tool).toBeGreaterThanOrEqual(0)
    expect(second).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(tool)
    expect(tool).toBeLessThan(second)
  })

  it('流式轮缺 `segments`（旧桩/尚未收到事件）：回退旧顺序，工具在上、正文在下', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: message({ content: '正文在这里。' }),
        streaming: {
          phase: 'streaming' as const,
          text: '正文在这里。',
          thinking: '',
          toolCalls: [
            { call_id: 'c1', name: 'fresh__fresh_order_parse', label: '生鲜订单解析', status: 'success' as const },
          ],
          error: null,
          agentName: null,
        },
      },
    })

    const [tool, text] = order(wrapper.html(), '生鲜订单解析', '正文在这里。')

    expect(tool).toBeGreaterThanOrEqual(0)
    expect(text).toBeGreaterThanOrEqual(0)
    expect(tool).toBeLessThan(text)
  })

  it('历史消息（无流式瞬态）：工具记录在前、整段正文在后（history.jsonl 口径）', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: message({
          content: '最终结论：共 3 行。',
          status: 'completed',
          tool_calls: [toolRecord()],
        }),
      },
    })

    const [tool, text] = order(wrapper.html(), '生鲜订单解析', '最终结论：共 3 行。')

    expect(tool).toBeGreaterThanOrEqual(0)
    expect(text).toBeGreaterThanOrEqual(0)
    expect(tool).toBeLessThan(text)
  })

  it('流式轮只有正文（无工具）：单段渲染，不产生空卡片', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: message({ content: '直接回答。' }),
        streaming: {
          phase: 'streaming' as const,
          text: '直接回答。',
          thinking: '',
          toolCalls: [],
          stalled: false,
          segments: [{ kind: 'text' as const, text: '直接回答。' }],
          error: null,
          agentName: null,
        },
      },
    })

    expect(wrapper.html()).toContain('直接回答。')
    expect(wrapper.find('.message-bubble__tools').exists()).toBe(false)
  })
})
