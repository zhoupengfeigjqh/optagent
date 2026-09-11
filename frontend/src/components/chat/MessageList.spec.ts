import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { Message } from '../../api/types'
import { flush } from '../../../tests/helpers'
import MessageBubble from './MessageBubble.vue'
import MessageList from './MessageList.vue'

function message(id: string, content: string, role: Message['role'] = 'assistant'): Message {
  return { id, role, content, ts: '2026-09-10T08:00:00.000Z', feedback: null }
}

describe('MessageList', () => {
  it('空消息且无流式时展示初始入口占位', () => {
    const wrapper = mount(MessageList)
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(wrapper.find('.message-bubble').exists()).toBe(false)
  })

  it('empty 插槽可替换默认占位', () => {
    const wrapper = mount(MessageList, { slots: { empty: '<div class="custom-empty">空</div>' } })
    expect(wrapper.find('.custom-empty').exists()).toBe(true)
    expect(wrapper.find('.empty-state').exists()).toBe(false)
  })

  it('逐条渲染消息气泡', () => {
    const wrapper = mount(MessageList, {
      props: { messages: [message('m1', '你好', 'user'), message('m2', '你好，有什么可以帮你')] },
    })
    expect(wrapper.findAll('.message-bubble')).toHaveLength(2)
    expect(wrapper.find('.empty-state').exists()).toBe(false)
  })

  it('流式时追加合成气泡并展示等待指示', () => {
    const wrapper = mount(MessageList, {
      props: {
        streaming: {
          phase: 'streaming',
          text: '',
          thinking: '',
          toolCalls: [],
          error: null,
          agentName: 'ops',
        },
      },
    })
    expect(wrapper.findAll('.message-bubble')).toHaveLength(1)
    expect(wrapper.find('.typing-indicator').exists()).toBe(true)
    // 流式气泡标注本轮数字人（会话可跨数字人，FR-014 修订）
    expect(wrapper.find('.message-bubble__role').text()).toBe('ops · 助手')
    // 有流式时不再展示空态占位
    expect(wrapper.find('.empty-state').exists()).toBe(false)
  })

  it('hasMore 时展示加载入口并派发 load-more', async () => {
    const wrapper = mount(MessageList, {
      props: { messages: [message('m1', 'a')], hasMore: true },
    })
    const button = wrapper.find('.message-list__more')
    expect(button.exists()).toBe(true)

    await button.trigger('click')
    expect(wrapper.emitted('load-more')).toHaveLength(1)
  })

  it('无更早历史时不展示加载入口', () => {
    const wrapper = mount(MessageList, { props: { messages: [message('m1', 'a')] } })
    expect(wrapper.find('.message-list__more').exists()).toBe(false)
  })

  it('搜索命中序号跨消息累计', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [message('m1', '甲 甲'), message('m2', '甲')],
        searchKeyword: '甲',
      },
    })
    const bubbles = wrapper.findAll('.message-bubble')
    const marksOf = (index: number) =>
      bubbles[index]
        .findAll('.message-content__mark')
        .map((mark) => mark.attributes('data-match-index'))

    expect(marksOf(0)).toEqual(['0', '1'])
    expect(marksOf(1)).toEqual(['2'])
  })

  it('仅对当前活跃命中做 DOM 标记', async () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [message('m1', '甲 甲'), message('m2', '甲')],
        searchKeyword: '甲',
        activeMatchIndex: 2,
      },
    })
    await Promise.resolve()

    const active = wrapper.findAll('[data-active-match="true"]')
    expect(active).toHaveLength(1)
    expect(active[0].attributes('data-match-index')).toBe('2')
  })

  it('向上透传消息反馈事件', async () => {
    const wrapper = mount(MessageList, { props: { messages: [message('m1', '你好')] } })
    wrapper
      .findComponent(MessageBubble)
      .vm.$emit('feedback', { message_id: 'm1', value: 'up' })

    await Promise.resolve()
    expect(wrapper.emitted('feedback')).toEqual([[{ message_id: 'm1', value: 'up' }]])
  })

  it('活跃序号为 -1 时不标记任何命中', async () => {
    const wrapper = mount(MessageList, {
      props: { messages: [message('m1', '甲')], searchKeyword: '甲' },
    })
    await Promise.resolve()
    expect(wrapper.findAll('[data-active-match="true"]')).toHaveLength(0)
  })

  /* ---------- 自动置底 ---------- */

  /** 伪造滚动几何量（jsdom 不做布局，默认全为 0） */
  function withGeometry(
    wrapper: VueWrapper,
    scrollHeight: number,
    clientHeight: number,
  ): HTMLElement {
    const element = wrapper.find('.message-list').element as HTMLElement
    Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true })
    Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true })
    return element
  }

  it('切换会话：消息整体替换后跳到最新', async () => {
    const wrapper = mount(MessageList, { props: { messages: [message('a1', '旧')] } })
    await flush() // 先让挂载后的置底回调落定，再伪造几何量
    const element = withGeometry(wrapper, 500, 200)
    element.scrollTop = 0

    await wrapper.setProps({ messages: [message('b1', '新'), message('b2', '新2')] })
    await flush()

    expect(element.scrollTop).toBe(500)
  })

  it('追加新消息：原本贴底时继续跟随', async () => {
    const wrapper = mount(MessageList, { props: { messages: [message('m1', 'a')] } })
    await flush()
    const element = withGeometry(wrapper, 600, 200)
    element.scrollTop = 350 // 距底 50px，视为跟随中

    await wrapper.setProps({ messages: [message('m1', 'a'), message('m2', 'b')] })
    await flush()

    expect(element.scrollTop).toBe(600)
  })

  it('用户向上翻阅时不打扰（不强制置底）', async () => {
    const wrapper = mount(MessageList, { props: { messages: [message('m1', 'a')] } })
    await flush()
    const element = withGeometry(wrapper, 600, 200)
    element.scrollTop = 0
    await wrapper.trigger('scroll') // 记录"未跟随"

    await wrapper.setProps({ messages: [message('m1', 'a'), message('m2', 'b')] })
    await flush()

    expect(element.scrollTop).toBe(0)
  })

  it('加载更早消息（前插）不跳到底部', async () => {
    const wrapper = mount(MessageList, { props: { messages: [message('m10', 'a')] } })
    await flush()
    const element = withGeometry(wrapper, 400, 200)
    element.scrollTop = 100

    await wrapper.setProps({ messages: [message('m9', '更早'), message('m10', 'a')] })
    await flush()

    // 注：jsdom 无布局，无法验证"补偿新增高度"；这里只守住"不跳到底部"
    expect(element.scrollTop).toBe(100)
  })

  it('流式增量：贴底时跟随最新', async () => {
    const wrapper = mount(MessageList, { props: { messages: [message('m1', 'a')] } })
    await flush()
    const element = withGeometry(wrapper, 700, 200)
    element.scrollTop = 550

    await wrapper.setProps({
      streaming: {
        phase: 'streaming',
        text: '部分内容',
        thinking: '',
        toolCalls: [],
        error: null,
        agentName: null,
      },
    })
    await flush()

    expect(element.scrollTop).toBe(700)
  })
})
