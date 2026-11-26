import { flushPromises, mount } from '@vue/test-utils'
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


const ATTACHMENT = { dir: '数据准备/生产计划', filename: 'plan.csv' }

const FAILED_TURN_USER: Message = {
  id: 'm_u1',
  role: 'user',
  content: '帮我看看这份计划',
  ts: '2026-10-15T09:00:00Z',
  feedback: null,
  attachments: [ATTACHMENT],
}

const FAILED_TURN: Message = {
  id: 'm_a1',
  role: 'assistant',
  content: '',
  ts: '2026-10-15T09:00:01Z',
  feedback: null,
  status: 'failed',
  error: { code: 'LLM_UNAVAILABLE', message: 'upstream 503' },
}

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

describe('MessageList —— 失败轮「重试本轮」（TR-58）', () => {
  const EARLIER: Message[] = [
    {
      id: 'm_u0',
      role: 'user',
      content: '第一轮的问题',
      ts: '2026-10-15T08:00:00Z',
      feedback: null,
    },
    {
      id: 'm_a0',
      role: 'assistant',
      content: '第一轮的回答',
      ts: '2026-10-15T08:00:01Z',
      feedback: null,
      status: 'completed',
    },
  ]

  it('点击入口上抛**同轮**的用户消息（正文 + 引用），不是更早那一轮', async () => {
    const wrapper = mount(MessageList, {
      props: { messages: [...EARLIER, FAILED_TURN_USER, FAILED_TURN] },
    })

    const retry = wrapper.find('.error-notice__retry')
    expect(retry.exists()).toBe(true)
    expect(retry.text()).toBe('重试本轮')

    await retry.trigger('click')

    expect(wrapper.emitted('retry')).toEqual([
      [{ content: '帮我看看这份计划', attachments: [ATTACHMENT] }],
    ])
  })

  it('同轮用户消息不在已加载窗口内（窗口首条即失败轮）：不渲染入口，不留"点了没反应"的按钮', () => {
    const wrapper = mount(MessageList, {
      props: { messages: [FAILED_TURN], hasMore: true },
    })

    expect(wrapper.find('.error-notice').exists()).toBe(true)
    expect(wrapper.find('.error-notice__retry').exists()).toBe(false)
    expect(wrapper.emitted('retry')).toBeUndefined()
  })

  it('"加载更早的消息"补进同轮用户消息后，入口随之长出来', async () => {
    const wrapper = mount(MessageList, {
      props: { messages: [FAILED_TURN], hasMore: true },
    })
    expect(wrapper.find('.error-notice__retry').exists()).toBe(false)

    await wrapper.setProps({ messages: [FAILED_TURN_USER, FAILED_TURN], hasMore: false })

    expect(wrapper.find('.error-notice__retry').exists()).toBe(true)
  })
})

describe('MessageList —— 工具卡片的 live 语境（TR-33）', () => {
  const runningTool = { call_id: 'c_run', name: 'ocr_image', status: 'running' as const }

  it('流式气泡里的 running 工具显示"进行中"（结果稍后还会到）', () => {
    const wrapper = mount(MessageList, {
      props: { streaming: { ...STREAMING_VIEW, toolCalls: [runningTool] } },
    })

    expect(wrapper.text()).toContain('ocr_image')
    expect(wrapper.text()).toContain('进行中')
    expect(wrapper.text()).toContain('本轮 1 次调用')
  })

  it('同一条 running 记录落在历史里时显示"未完成"（它不会再动了）', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [
          {
            id: 'm_1',
            role: 'assistant',
            content: '本轮被中断',
            ts: '2026-10-08T10:00:00Z',
            feedback: null,
            tool_calls: [
              {
                call_id: 'c_run',
                name: 'ocr_image',
                status: 'running',
                started_at: '2026-10-08T10:00:00.000Z',
              },
            ],
          },
        ],
      },
    })

    expect(wrapper.text()).toContain('未完成')
    expect(wrapper.text()).not.toContain('进行中')
  })
})


function installScrollMetrics(
  element: Element,
  scrollHeight: number,
  clientHeight: number,
): () => number {
  let scrollTop = 0
  Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true })
  Object.defineProperty(element, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value
    },
    configurable: true,
  })
  return () => scrollTop
}

const JUMP = '[data-test="message-list-jump"]'

describe('MessageList —— 置底与「回到底部」（2026-10-16）', () => {
  it('用户上翻后再发消息：不看 80px 阈值，立刻回到最底并收起箭头', async () => {
    const wrapper = mount(MessageList, {
      props: { messages: HISTORICAL, streaming: STREAMING_VIEW },
    })
    // 先让 `onMounted` 那一次置底落地，否则它会盖掉下面这次"用户上翻"
    await flushPromises()
    const list = wrapper.find('.message-list')
    const readScrollTop = installScrollMetrics(list.element, 1000, 300)

    list.element.scrollTop = 300
    await list.trigger('scroll')
    expect(wrapper.find(JUMP).exists()).toBe(true)

    await wrapper.setProps({ pendingUser: { content: '再看看这份', attachments: [] } })
    await flushPromises()

    expect(readScrollTop()).toBe(1000)
    expect(wrapper.find(JUMP).exists()).toBe(false)
  })

  it('箭头只在距底超过阈值时出现：贴底与 80px 以内都不显示', async () => {
    const wrapper = mount(MessageList, {
      props: { messages: HISTORICAL, streaming: STREAMING_VIEW },
    })
    const list = wrapper.find('.message-list')
    installScrollMetrics(list.element, 1000, 300)

    list.element.scrollTop = 700
    await list.trigger('scroll')
    expect(wrapper.find(JUMP).exists()).toBe(false)

    list.element.scrollTop = 620
    await list.trigger('scroll')
    expect(wrapper.find(JUMP).exists()).toBe(false)

    list.element.scrollTop = 600
    await list.trigger('scroll')
    expect(wrapper.find(JUMP).exists()).toBe(true)
  })

  it('点箭头回到最底，箭头随之消失', async () => {
    const wrapper = mount(MessageList, {
      props: { messages: HISTORICAL, streaming: STREAMING_VIEW },
    })
    // 先让 `onMounted` 那一次置底落地，否则它会盖掉下面这次"用户上翻"
    await flushPromises()
    const list = wrapper.find('.message-list')
    const readScrollTop = installScrollMetrics(list.element, 1000, 300)

    list.element.scrollTop = 100
    await list.trigger('scroll')
    expect(wrapper.find(JUMP).exists()).toBe(true)

    await wrapper.find(JUMP).trigger('click')

    expect(readScrollTop()).toBe(1000)
    expect(wrapper.find(JUMP).exists()).toBe(false)
  })

  it('内容不满一屏（scrollHeight === clientHeight）：箭头始终不出现', async () => {
    const wrapper = mount(MessageList, { props: { messages: HISTORICAL } })
    await flushPromises()
    const list = wrapper.find('.message-list')
    installScrollMetrics(list.element, 300, 300)

    await list.trigger('scroll')

    expect(wrapper.find(JUMP).exists()).toBe(false)
  })
})

/**
 * 切回旧会话恢复上次滚动位置（2026-10-16）。
 *
 * 只恢复**上翻过**的会话：贴底离开的会话切回来仍然置底——否则"回来看到最新进展"
 * 这条更强的语义会被破坏，也与"发消息必须看到自己的话"自相矛盾。
 */
describe('MessageList —— 切回旧会话恢复滚动位置（2026-10-16）', () => {
  const OTHER: Message[] = [
    {
      id: 'm_other',
      role: 'user',
      content: '另一个会话',
      ts: '2026-10-16T10:00:00Z',
      feedback: null,
    },
  ]

  it('上翻过的会话切回来落在原位置（不强制置底），箭头仍显示', async () => {
    const wrapper = mount(MessageList, { props: { threadId: 'th_a', messages: HISTORICAL } })
    await flushPromises()
    const list = wrapper.find('.message-list')
    const readScrollTop = installScrollMetrics(list.element, 1000, 300)

    list.element.scrollTop = 300
    await list.trigger('scroll')
    expect(wrapper.find(JUMP).exists()).toBe(true)

    await wrapper.setProps({ threadId: 'th_b', messages: OTHER })
    await flushPromises()
    expect(readScrollTop()).toBe(1000)

    await wrapper.setProps({ threadId: 'th_a', messages: HISTORICAL })
    await flushPromises()
    expect(readScrollTop()).toBe(300)
    expect(wrapper.find(JUMP).exists()).toBe(true)

    wrapper.unmount()
  })

  it('贴底离开的会话切回来仍置底（贴底不留存档，避免"回来看到半截历史"）', async () => {
    const wrapper = mount(MessageList, { props: { threadId: 'th_a', messages: HISTORICAL } })
    await flushPromises()
    const list = wrapper.find('.message-list')
    const readScrollTop = installScrollMetrics(list.element, 1000, 300)

    list.element.scrollTop = 200
    await list.trigger('scroll')
    list.element.scrollTop = 1000
    await list.trigger('scroll')
    expect(wrapper.find(JUMP).exists()).toBe(false)

    await wrapper.setProps({ threadId: 'th_b', messages: OTHER })
    await flushPromises()
    await wrapper.setProps({ threadId: 'th_a', messages: HISTORICAL })
    await flushPromises()

    expect(readScrollTop()).toBe(1000)
    expect(wrapper.find(JUMP).exists()).toBe(false)

    wrapper.unmount()
  })
})

/**
 * 流式正文的读屏播报（2026-10-16）。
 *
 * 这里钉的是"**播什么、不播什么**"：逐 token 的正文变化必须静默（否则 live 区每帧
 * 变一次，播报被反复打断，等于噪音），只在回答落盘时播一句结论；
 * 结构与文案一起断言——只测文案的话，容器哪天被误改成自动播报就没人发现了。
 */
describe('MessageList —— 读屏播报（2026-10-16）', () => {
  const DONE_ASSISTANT: Message = {
    id: 'm_done',
    role: 'assistant',
    agent_name: 'demo',
    content: '生产计划已核对完毕',
    ts: '2026-10-16T11:00:00Z',
    status: 'completed',
    feedback: null,
  }

  it('正文区不自动播报：日志容器与流式气泡都显式 aria-live="off"', async () => {
    const wrapper = mount(MessageList, {
      props: { messages: HISTORICAL, streaming: STREAMING_VIEW },
    })
    await flushPromises()

    const list = wrapper.find('.message-list')
    expect(list.attributes('role')).toBe('log')
    expect(list.attributes('aria-live')).toBe('off')
    expect(wrapper.find('.message-list [aria-live="off"]').exists()).toBe(true)
  })

  it('回答落盘 → 播报"已完成 + 字数"（一次结论，而非逐 token）', async () => {
    const wrapper = mount(MessageList, {
      props: { messages: HISTORICAL, streaming: STREAMING_VIEW },
    })
    await flushPromises()
    const announce = wrapper.find('[data-test="message-list-announce"]')
    expect(announce.text()).toBe('')

    await wrapper.setProps({ streaming: null, messages: [...HISTORICAL, DONE_ASSISTANT] })
    await flushPromises()

    expect(announce.text()).toBe('回答已完成，共 9 字')
  })

  it('失败轮落盘：不播报（失败由 ErrorNotice 的 role=alert 负责，避免双重播报）', async () => {
    const wrapper = mount(MessageList, { props: { messages: HISTORICAL } })
    await flushPromises()

    await wrapper.setProps({
      messages: [...HISTORICAL, { ...DONE_ASSISTANT, id: 'm_failed', status: 'failed' }],
    })
    await flushPromises()

    expect(wrapper.find('[data-test="message-list-announce"]').text()).toBe('')
  })
})

/**
 * 「对话没结束就不许有空档」（2026-11-26）。
 *
 * 列表层有两条会让整块内容消失的收敛：`isEmpty`（什么都没有时落空状态）与
 * `streamingMessage`（终结态无正文时丢弃合成气泡）。前者由 `pendingUser`/`streaming`
 * 兜住，后者必须只对**失败轮**成立——中断轮没有任何别的提示位。
 */
describe('MessageList —— 本轮状态的可见性（2026-11-26）', () => {
  it('streaming 且正文为空 → 气泡照常存在并承载「思考中」', () => {
    const wrapper = mount(MessageList, { props: { streaming: STREAMING_VIEW } })

    expect(wrapper.find('.empty-state').exists()).toBe(false)
    expect(wrapper.find('.typing-indicator').text()).toBe('思考中')
  })

  it('中断轮正文为空 → 仍保留气泡，给出「已停止生成」而不是一片空白', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: HISTORICAL,
        streaming: { ...STREAMING_VIEW, phase: RUN_PHASE.ABORTED },
      },
    })

    expect(wrapper.find('.message-bubble__aborted').exists()).toBe(true)
    expect(wrapper.text()).toContain('已停止生成')
    expect(wrapper.find('.typing-indicator').exists()).toBe(false)
  })

  it('失败轮正文为空 → 不留空气泡（本轮错误由 ChatPanel 的 ErrorNotice 承载）', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: HISTORICAL,
        streaming: { ...STREAMING_VIEW, phase: RUN_PHASE.FAILED },
      },
    })

    expect(wrapper.findAll('.message-bubble')).toHaveLength(1)
    expect(wrapper.find('.message-bubble').text()).toContain('上一条消息')
  })
})
