/**
 * 组件测试：消息列表。
 *
 * 1. **乐观用户气泡**（2026-09-16 十七次调整）：用户消息只在历史刷新（流完成后）才渲染，
 *    发送后要到 AI 答完才看到自己的消息。修复后 `pendingUser` 应在历史消息**之后**、
 *    流式气泡**之前**渲染为用户气泡；`null` 时（无进行中轮次）不渲染。
 * 2. **工具卡片的 `live` 语境**（2026-10-08，TR-33）：`MessageBubble` 把"本轮是否仍在流式"
 *    传给了卡片，同样一条 `running` 记录在流式态应显示"进行中"、在历史里应显示"未完成"。
 *    （`MessageBubble.vue` 无同名测试，这条集成断言是它那处 `:live` 绑定的保护网。）
 * 3. **失败轮「重试本轮」**（2026-10-15，TR-58）：历史失败轮的入口原先悬空（气泡发 `retry`
 *    而列表层没接），这里从用户可见行为上钉住三件事——重发的是**同轮**的用户消息、
 *    该用户消息不在窗口内时**不给入口**（不留死按钮）、"加载更早消息"后入口必须长出来。
 * 4. **置底与「回到底部」**（2026-10-16）：上翻后发消息曾被静默吞掉（旧实现只在 `stick`
 *    为真时才跟随），现在本端发起一轮即强制置底；非底部时右下角浮出箭头，点击回到底部
 *    并收起。jsdom 不参与布局，滚动尺寸由 `installScrollMetrics` 显式装上。
 */
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

/* ---------- 失败轮（TR-58）夹具 ---------- */

const ATTACHMENT = { dir: '数据准备/生产计划', filename: 'plan.csv' }

/** 失败轮的同轮用户消息：带引用（重发时要原样带上） */
const FAILED_TURN_USER: Message = {
  id: 'm_u1',
  role: 'user',
  content: '帮我看看这份计划',
  ts: '2026-10-15T09:00:00Z',
  feedback: null,
  attachments: [ATTACHMENT],
}

/** 失败轮本体：`status='failed'` + `error` 才有 `ErrorNotice`（含重试入口） */
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

    // 失败提示本身照常（可感知），但重发所需的那一轮还没加载 → 不给入口
    expect(wrapper.find('.error-notice').exists()).toBe(true)
    expect(wrapper.find('.error-notice__retry').exists()).toBe(false)
    expect(wrapper.emitted('retry')).toBeUndefined()
  })

  it('"加载更早的消息"补进同轮用户消息后，入口随之长出来', async () => {
    const wrapper = mount(MessageList, {
      props: { messages: [FAILED_TURN], hasMore: true },
    })
    expect(wrapper.find('.error-notice__retry').exists()).toBe(false)

    // 前插更早消息：既有气泡的对象身份与首尾 id 都没变（`v-memo` 的比较项里含入口文案）
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

/* ---------- 置底与「回到底部」（2026-10-16） ---------- */

/**
 * 装上可用的滚动尺寸。
 *
 * jsdom 不参与布局：`scrollHeight` / `clientHeight` 恒为 0、写 `scrollTop` 也没反应，
 * 所以三者都要显式定义（`scrollTop` 用可写存取器，便于模拟"用户上翻"）。
 * 返回读取当前 `scrollTop` 的函数——"有没有真的被程序化置底"要看它。
 *
 * 时序要求：必须在 `await flushPromises()` **之后**调用——挂载期的置底会先写一次
 * `scrollTop`，若让它在装好尺寸之后落地，就会把"用户上翻"一并冲掉。
 */
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

    // 上翻到中途：距底 700px → 自动跟随已暂停，箭头出现
    list.element.scrollTop = 300
    await list.trigger('scroll')
    expect(wrapper.find(JUMP).exists()).toBe(true)

    // 本端发起一轮（乐观气泡出现 = 用户按了发送）
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

    // 贴底：距底 0
    list.element.scrollTop = 700
    await list.trigger('scroll')
    expect(wrapper.find(JUMP).exists()).toBe(false)

    // 距底 80px：仍在"跟随最新"的口径内，不打扰
    list.element.scrollTop = 620
    await list.trigger('scroll')
    expect(wrapper.find(JUMP).exists()).toBe(false)

    // 距底 100px：越界，箭头出现
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
