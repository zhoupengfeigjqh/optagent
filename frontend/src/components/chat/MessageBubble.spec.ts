import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { Message } from '../../api/types'
import MessageBubble from './MessageBubble.vue'

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    role: 'assistant',
    content: '求解完成',
    ts: '2026-09-10T08:00:00.000Z',
    feedback: null,
    ...overrides,
  }
}

describe('MessageBubble', () => {
  it('助手消息默认按 pending 态渲染（无 id / 无 status）', () => {
    const wrapper = mount(MessageBubble, { props: { message: message({ id: '' }) } })
    expect(wrapper.classes()).toContain('message-bubble--assistant')
    expect(wrapper.classes()).toContain('message-bubble--pending')
    expect(wrapper.find('.message-bubble__role').text()).toBe('助手')
    expect(wrapper.text()).toContain('求解完成')
  })

  it('assistant 消息标注本轮数字人（会话可跨数字人，FR-014 修订）', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: message({ id: 'm1', status: 'completed', agent_name: 'ops' }) },
    })
    expect(wrapper.find('.message-bubble__role').text()).toBe('ops · 助手')
  })

  it('流式气泡取本轮数字人快照', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: message({ id: '' }),
        streaming: {
          phase: 'streaming',
          text: '生成中',
          thinking: '',
          toolCalls: [],
          error: null,
          agentName: 'analyst',
        },
      },
    })
    expect(wrapper.find('.message-bubble__role').text()).toBe('analyst · 助手')
  })

  it('缺省 agent_name 时回退为「助手」（旧数据兼容）', () => {
    const wrapper = mount(MessageBubble, { props: { message: message({}) } })
    expect(wrapper.find('.message-bubble__role').text()).toBe('助手')
  })

  it('completed 且有 id 时进入可操作态（V-07）', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: message({ id: 'm1', status: 'completed' }) },
    })
    expect(wrapper.classes()).toContain('message-bubble--completed')
  })

  it('用户消息靠右展示，并还原 @ 引用', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: message({
          role: 'user',
          content: '看一下',
          attachments: [
            { dir: '生产计划', filename: 'plan.csv' },
            { dir: 'shared', filename: 'rule.txt' },
          ],
        }),
      },
    })
    expect(wrapper.classes()).toContain('message-bubble--user')
    expect(wrapper.find('.message-bubble__role').text()).toBe('我')
    expect(wrapper.findAll('.message-bubble__ref').map((node) => node.text())).toEqual([
      '@plan.csv',
      '@rule.txt',
    ])
  })

  it('流式期间展示思考块、工具徽标与「思考中」', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: message({ id: '', content: '' }),
        streaming: {
          phase: 'streaming',
          text: '',
          thinking: '先分析约束',
          toolCalls: [{ call_id: 'c1', name: 'read_file', status: 'running' }],
          error: null,
          agentName: null,
        },
      },
    })
    expect(wrapper.find('.thinking-block').exists()).toBe(true)
    expect(wrapper.find('.tool-call-badge__name').text()).toBe('read_file')
    expect(wrapper.find('.typing-indicator').exists()).toBe(true)
  })

  it('已有正文时不再展示「思考中」', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: message({ id: '', content: '部分回答' }),
        streaming: {
          phase: 'streaming',
          text: '部分回答',
          thinking: '',
          toolCalls: [],
          error: null,
          agentName: null,
        },
      },
    })
    expect(wrapper.find('.typing-indicator').exists()).toBe(false)
    expect(wrapper.find('.tool-call-badge').exists()).toBe(false)
  })

  it('failed 态展示错误文案与重试入口', async () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: message({
          id: 'm9',
          status: 'failed',
          error: { code: 'INTERNAL_ERROR', message: 'boom' },
        }),
      },
    })
    expect(wrapper.classes()).toContain('message-bubble--failed')
    expect(wrapper.find('.error-notice__message').text()).toBe('系统繁忙，请稍后重试')

    await wrapper.find('.error-notice__retry').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('流式失败由 ChatPanel 统一提示，气泡内不重复告警', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: message({ id: '', content: '半截回答' }),
        streaming: {
          phase: 'failed',
          text: '半截回答',
          thinking: '',
          toolCalls: [],
          error: { code: 'STREAM_DISCONNECTED', message: '' },
          agentName: null,
        },
      },
    })
    expect(wrapper.find('.error-notice').exists()).toBe(false)
    expect(wrapper.text()).toContain('半截回答')
  })

  it('搜索命中跨消息基准序号参与高亮，并标记活跃气泡', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: message({ content: '甲 甲' }),
        searchKeyword: '甲',
        matchIndexBase: 3,
        activeMatchIndex: 4,
      },
    })
    expect(
      wrapper.findAll('.message-content__mark').map((mark) => mark.attributes('data-match-index')),
    ).toEqual(['3', '4'])
    expect(wrapper.classes()).toContain('message-bubble--search-active')
  })

  it('活跃序号不在本消息范围内则不标记', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: message({ content: '甲' }),
        searchKeyword: '甲',
        matchIndexBase: 0,
        activeMatchIndex: 5,
      },
    })
    expect(wrapper.classes()).not.toContain('message-bubble--search-active')
  })

  it('completed 且有 id 时展示操作区与用量（V-07）', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: message({
          id: 'm1',
          status: 'completed',
          usage: { input_tokens: 3, output_tokens: 5 },
          duration_seconds: 1.24,
        }),
      },
    })
    expect(wrapper.find('.message-actions').exists()).toBe(true)
    expect(wrapper.find('.message-actions__usage').text()).toBe('输入 3 · 输出 5 tokens')
    expect(wrapper.find('.message-actions__duration').text()).toBe('1.2s')
  })

  it('进行中 / 中断 / 失败的消息不展示操作区', () => {
    // 进行中（无 status、无 id，流式合成气泡）
    const streamingBubble = mount(MessageBubble, { props: { message: message({ id: '' }) } })
    expect(streamingBubble.find('.message-actions').exists()).toBe(false)

    // 已中断（无 status、无 id）
    const aborted = mount(MessageBubble, {
      props: { message: message({ id: '', content: '半截' }) },
    })
    expect(aborted.find('.message-actions').exists()).toBe(false)

    // 失败轮（即便有 id 也不可操作，FR-049 / FR-028）
    const failed = mount(MessageBubble, {
      props: {
        message: message({
          id: 'm9',
          status: 'failed',
          error: { code: 'INTERNAL_ERROR', message: '' },
        }),
      },
    })
    expect(failed.find('.message-actions').exists()).toBe(false)
  })

  it('点赞/点踩上报 message_id 与取值', async () => {
    const completed = {
      id: 'm1',
      status: 'completed' as const,
    }
    const wrapper = mount(MessageBubble, { props: { message: message(completed) } })

    await wrapper.find('.message-actions__up').trigger('click')
    expect(wrapper.emitted('feedback')).toEqual([[{ message_id: 'm1', value: 'up' }]])

    await wrapper.find('.message-actions__down').trigger('click')
    expect(wrapper.emitted('feedback')).toEqual([
      [{ message_id: 'm1', value: 'up' }],
      [{ message_id: 'm1', value: 'down' }],
    ])
  })

  it('同值重复点击 = 取消，提交 null（V-08）', async () => {
    const wrapper = mount(MessageBubble, {
      props: { message: message({ id: 'm1', status: 'completed', feedback: 'up' }) },
    })
    await wrapper.find('.message-actions__up').trigger('click')
    expect(wrapper.emitted('feedback')).toEqual([[{ message_id: 'm1', value: null }]])
  })

  it('复制上报 message_id', async () => {
    const wrapper = mount(MessageBubble, {
      props: { message: message({ id: 'm1', status: 'completed' }) },
    })
    await wrapper.find('.message-actions__copy').trigger('click')
    expect(wrapper.emitted('copy')).toEqual([['m1']])
  })
})
