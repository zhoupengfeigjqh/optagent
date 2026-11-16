/**
 * 组件测试：等待提示在**工具执行空档期**的表现（2026-11-16）
 *
 * 需求背景：工具执行可能持续数秒到数十秒，聊天区必须有可见的"还在跑"信号。
 * 旧判据只有 `content === ''`，模型先说一句「我来查一下」再调工具时提示会整轮消失
 * （只剩卡片上一行静态「进行中」）。这里把新判据钉住：
 *
 * 1. 首个 token 前 → 「思考中」；
 * 2. 有 running 的工具 → 「正在执行 <工具名>…」（点名，多个则报数量）；
 * 3. 工具全部结束、正文在流式输出 → **不补提示**（正文本身在长，避免噪音）；
 * 4. 非 streaming 阶段（completed/failed/aborted）即使残留 running 记录也不提示。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { Message } from '../../api/types'
import MessageBubble from './MessageBubble.vue'

interface ToolCallView {
  call_id: string
  name: string
  label?: string
  status: 'running' | 'success' | 'error'
}

function message(over: Partial<Message> = {}): Message {
  // 流式合成消息不落库：无 id、无 status（`MessageList.streamingMessage` 同口径）
  return {
    id: '',
    role: 'assistant',
    content: '',
    ts: '2026-11-16T08:00:00.000Z',
    feedback: null,
    ...over,
  }
}

/** 流式态瞬态桩（结构与 `MessageBubble.streaming` 同构） */
function streaming(text: string, toolCalls: ToolCallView[], stalled = false) {
  return {
    phase: 'streaming' as const,
    text,
    thinking: '',
    toolCalls,
    stalled,
    error: null,
    agentName: null,
  }
}

function mountStreaming(text: string, toolCalls: ToolCallView[], stalled = false) {
  return mount(MessageBubble, {
    props: { message: message({ content: text }), streaming: streaming(text, toolCalls, stalled) },
  })
}

function running(over: Partial<ToolCallView> = {}): ToolCallView {
  return { call_id: 'c1', name: 'fresh__fresh_order_parse', status: 'running', ...over }
}

describe('MessageBubble —— 工具执行期的等待提示', () => {
  it('首个 token 未到（正文为空、无工具）→ 显示「思考中」', () => {
    const wrapper = mountStreaming('', [])

    expect(wrapper.find('.typing-indicator').text()).toBe('思考中')
  })

  it('正文已非空 + 有 running 工具 → 点名工具，而不是静默', () => {
    const wrapper = mountStreaming('好的，我来解析这张订单。', [
      running({ label: '生鲜订单解析' }),
    ])

    expect(wrapper.find('.typing-indicator').text()).toBe('正在执行 生鲜订单解析…')
  })

  it('多个工具并行 → 用数量表达，不堆名字', () => {
    const wrapper = mountStreaming('正在处理。', [
      running({ call_id: 'c1', label: '生鲜订单解析' }),
      running({ call_id: 'c2', label: '读取文件' }),
    ])

    expect(wrapper.find('.typing-indicator').text()).toBe('正在执行 2 个工具…')
  })

  it('同一工具重复出现两次 → 去重后仍按单个点名', () => {
    const wrapper = mountStreaming('正在处理。', [
      running({ call_id: 'c1', label: '生鲜订单解析' }),
      running({ call_id: 'c2', label: '生鲜订单解析' }),
    ])

    expect(wrapper.find('.typing-indicator').text()).toBe('正在执行 生鲜订单解析…')
  })

  it('没有人读名称（label）时回退原始工具名', () => {
    const wrapper = mountStreaming('正在处理。', [running()])

    expect(wrapper.find('.typing-indicator').text()).toBe(
      '正在执行 fresh__fresh_order_parse…',
    )
  })

  it('工具全部结束、正文在输出 → 不显示等待提示（避免与流式正文重复）', () => {
    const wrapper = mountStreaming('已解析完成，共 3 行。', [
      running({ status: 'success', label: '生鲜订单解析' }),
    ])

    expect(wrapper.find('.typing-indicator').exists()).toBe(false)
  })

  it('正文为空但工具已结束 → 仍显示「思考中」（模型在准备下一段）', () => {
    const wrapper = mountStreaming('', [running({ status: 'success', label: '生鲜订单解析' })])

    expect(wrapper.find('.typing-indicator').text()).toBe('思考中')
  })

  it('静默段（TR-66）：正文非空且 >2.5s 无事件 → 「模型正在思考…」', () => {
    // 实测形态：模型写完一段（1201 字）后静默 6.6s 才发出 tool_call，期间没有任何事件
    const wrapper = mountStreaming('好的，我先看一下这张订单。', [], true)

    expect(wrapper.find('.typing-indicator').text()).toBe('模型正在思考…')
  })

  it('工具执行中同时处于静默段 → 仍点名工具（工具态优先于泛化文案）', () => {
    const wrapper = mountStreaming('正在处理。', [running({ label: '生鲜订单解析' })], true)

    expect(wrapper.find('.typing-indicator').text()).toBe('正在执行 生鲜订单解析…')
  })

  it('静默已回落（stalled=false）且正文非空 → 不显示提示', () => {
    const wrapper = mountStreaming('已解析完成，共 3 行。', [], false)

    expect(wrapper.find('.typing-indicator').exists()).toBe(false)
  })

  it('非 streaming 阶段（已完成）即便残留 running 记录也不提示', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: message({ content: '已完成', status: 'completed' }),
        streaming: {
          phase: 'completed' as const,
          text: '已完成',
          thinking: '',
          toolCalls: [running()],
          error: null,
          agentName: null,
        },
      },
    })

    expect(wrapper.find('.typing-indicator').exists()).toBe(false)
  })
})
