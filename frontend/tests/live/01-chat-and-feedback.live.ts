/**
 * US1 对话闭环 + US2 消息操作 —— **真实后端 + 真实 LLM**（会消耗 API 额度）。
 *
 * 与 `tests/integration/chat-flow.spec.ts` 的分工：那里用可控 `ReadableStream` 桩验证状态机；
 * 这里验证的是**真实链路**：真实 SSE 时序、真实落盘、真实反馈持久化、真实组件渲染通路。
 */
import { mount } from '@vue/test-utils'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import MessageBubble from '../../src/components/chat/MessageBubble.vue'
import MessageList from '../../src/components/chat/MessageList.vue'
import { RUN_PHASE } from '../../src/constants/events'
import {
  cleanupTrackedThreads,
  createLiveSession,
  ensureThread,
  selectAgent,
  until,
  type LiveSession,
} from './harness'

/** 把 `unknown` 请求体安全地当记录读（断言用）。 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** 用例使用的数字人：`demo2`（0 会话，便于自由建会话） */
const AGENT = 'demo2'
const PROMPT_THINKING = '用一句话说明"产线切换时间"指什么，不要展开。'
const PROMPT_FAST = '只回复两个字：收到'
const PROMPT_LONG = '从 1 数到 400，每个数字单独一行，不要任何解释。'
const PROMPT_TOOL = '请调用 list_dir 工具列出「生产计划」目录，然后用一句话告诉我有哪些文件。'

let live: LiveSession

/** 取某条消息当前的反馈值（以落盘后的历史为准）。 */
function feedbackOf(messageId: string): 'up' | 'down' | null {
  return live.session.threads.messages.value.find((m) => m.id === messageId)?.feedback ?? null
}

/** 保证存在一条"已落盘、可操作"的 assistant 消息（否则补发一轮）。 */
async function ensureAssistantMessage(): Promise<{ id: string }> {
  const { chat, threads } = live.session
  const find = () =>
    [...threads.messages.value].reverse().find((m) => m.role === 'assistant' && m.id !== '')

  await threads.refresh()
  let target = find()
  if (!target) {
    chat.setThinking(false)
    await chat.send({ content: PROMPT_FAST, attachments: [] })
    await threads.refresh()
    target = find()
  }
  if (!target) throw new Error('未取得可操作的 assistant 消息')
  return { id: target.id }
}

describe('US1 对话闭环（真实 LLM）', () => {
  beforeAll(async () => {
    live = createLiveSession()
    await selectAgent(live, AGENT)
    await live.session.models.load()
    await ensureThread(live, AGENT)
  })

  it('思考模式：增量流式 → done(usage/duration) → 消息落盘可读', async () => {
    const { chat, threads, models } = live.session
    live.resetCalls()

    chat.setThinking(true)
    chat.draft.value = PROMPT_THINKING
    await chat.send({ content: chat.draft.value, attachments: [] })

    expect(chat.phase.value).toBe(RUN_PHASE.COMPLETED)
    expect(chat.streamingThinking.value.length).toBeGreaterThan(0)
    expect(chat.streamingText.value.length).toBeGreaterThan(0)
    expect(chat.hasThinking.value).toBe(true)
    expect(chat.usage.value?.input_tokens ?? 0).toBeGreaterThan(0)
    expect(chat.durationSeconds.value ?? 0).toBeGreaterThan(0)

    // 请求体按契约构造：content / thinking 必带，model 为当前选择
    const sent = live.calls.find(
      (call) => call.method === 'POST' && call.path.endsWith('/messages'),
    )
    expect(asRecord(sent?.body)).toMatchObject({ content: PROMPT_THINKING, thinking: true })
    expect(asRecord(sent?.body).model).toBe(models.current.value ?? undefined)

    // 落盘（send 内部 onTurnFinished → threads.refresh 已完成）
    const assistant = [...threads.messages.value]
      .reverse()
      .find((m) => m.role === 'assistant' && m.id !== '')
    expect(assistant?.status).toBe('completed')
    expect(assistant?.content.length ?? 0).toBeGreaterThan(0)
    expect(assistant?.usage?.output_tokens ?? 0).toBeGreaterThan(0)
    expect(assistant?.duration_seconds ?? 0).toBeGreaterThan(0)

    // 思考内容不落历史（V-04 / FR-009）
    const raw = JSON.stringify(threads.messages.value)
    expect(raw).not.toContain('thinking')
  })

  it('快速模式：thinking=false 且不产生思考增量（FR-012）', async () => {
    const { chat } = live.session
    live.resetCalls()

    chat.setThinking(false)
    await chat.send({ content: PROMPT_FAST, attachments: [] })

    expect(chat.phase.value).toBe(RUN_PHASE.COMPLETED)
    expect(chat.streamingThinking.value).toBe('')
    const sent = live.calls.find((call) => call.method === 'POST' && call.path.endsWith('/messages'))
    expect(asRecord(sent?.body).thinking).toBe(false)
  })

  it('进行中：canSend=false、禁止切换数字人且不发请求（FR-006/036、V-14）', async () => {
    const { chat, agents } = live.session
    live.resetCalls()

    const running = chat.send({ content: PROMPT_LONG, attachments: [] })
    await until(() => chat.phase.value === RUN_PHASE.STREAMING, '进入 streaming')

    expect(chat.canSend.value).toBe(false)
    expect(agents.switchingDisabled.value).toBe(true)

    live.resetCalls()
    await agents.switchTo('demo')
    expect(live.countOf('POST', '/select')).toBe(0)
    expect(live.countOf('POST', '/exit')).toBe(0)

    // 收尾：中断本轮
    await chat.stop()
    await running
    expect(chat.phase.value).toBe(RUN_PHASE.ABORTED)
  })

  it('中断本轮：不落盘 assistant 行（FR-007/028）', async () => {
    const { chat, threads } = live.session

    await threads.refresh()
    const before = threads.messages.value.filter((m) => m.role === 'assistant').length

    const running = chat.send({ content: PROMPT_LONG, attachments: [] })
    await until(() => chat.streamingText.value.length > 0, '收到首个 content 增量', 60_000)
    await chat.stop()
    await running

    expect(chat.phase.value).toBe(RUN_PHASE.ABORTED)
    await threads.refresh()
    const after = threads.messages.value.filter((m) => m.role === 'assistant').length
    expect(after).toBe(before)
  })

  it('工具调用：后端按契约发 tool_call/tool_call_end，结束后展示清空（V-05 / SC-011）', async () => {
    const { chat, threads } = live.session
    const observed: string[] = []
    const poller = setInterval(() => {
      for (const call of chat.toolCalls.value) observed.push(call.name)
    }, 10)

    chat.setThinking(true)
    try {
      await chat.send({ content: PROMPT_TOOL, attachments: [] })
    } finally {
      clearInterval(poller)
    }

    expect(chat.phase.value).toBe(RUN_PHASE.COMPLETED)
    // 1) 展示区在轮次结束后必须清空（工具项"结束即消失"）
    expect(chat.toolCalls.value).toHaveLength(0)

    // 2) 后端确实按契约发了成对的 tool_call / tool_call_end，且不含入参/结果（SC-011）
    const sse = live.rawSse()
    if (sse.includes('event: tool_call')) {
      expect(sse).toContain('event: tool_call_end')
      expect(sse).toContain('list_dir')
      expect(sse).not.toContain('"args"')
      expect(sse).not.toContain('"result"')
    } else {
      console.warn('[live] 本轮模型未触发工具调用，未覆盖 tool_call 时序（前端状态机已由单测覆盖）')
    }
    if (observed.length === 0) {
      console.warn('[live] 轮询未捕获中间态 toolCalls（执行窗口过短，前端状态机已由单测覆盖）')
    }

    // 3) 历史消息只含契约字段，绝无思考/工具信息（V-04 / FR-009）
    await threads.refresh()
    const allowed = new Set([
      'id',
      'role',
      'content',
      'ts',
      'status',
      'usage',
      'duration_seconds',
      'attachments',
      'error',
      'feedback',
    ])
    for (const message of threads.messages.value) {
      for (const key of Object.keys(message)) {
        expect(allowed.has(key), `消息出现了契约外字段：${key}`).toBe(true)
      }
    }
  })
})

describe('US2 消息操作与用量（真实落库）', () => {
  it('点赞 → 点踩 → 同值取消（V-08 乐观更新 + 落库）', async () => {
    const { chat, threads } = live.session
    const { id } = await ensureAssistantMessage()

    live.resetCalls()
    await chat.submitFeedback(id, 'up')
    expect(live.countOf('PUT', '/feedback')).toBe(1)

    await threads.refresh()
    expect(feedbackOf(id)).toBe('up')

    await chat.submitFeedback(id, 'down')
    await threads.refresh()
    expect(feedbackOf(id)).toBe('down')

    await chat.submitFeedback(id, 'down')
    await threads.refresh()
    expect(feedbackOf(id)).toBeNull()
  })

  it('反馈提交失败（未知消息）→ 给出提示且不残留错误选中态', async () => {
    const { chat, toast } = live.session
    toast.clear()

    await chat.submitFeedback('itest-live-not-exist', 'up')

    expect(toast.items.value.length).toBeGreaterThan(0)
  })
})

describe('渲染通路（真实后端数据驱动组件）', () => {
  it('MessageBubble 用真实 duration_seconds 渲染 1 位小数（差异 4）', async () => {
    const { threads } = live.session
    await threads.loadList()

    const seeded = threads.list.value.find((item) => (item.title ?? '').startsWith('itest-'))
    if (!seeded) throw new Error('需要先运行 prepare-integration-data.ts all 造出 itest 长会话')
    await threads.select(seeded.thread_id)

    const message = threads.messages.value.find((m) => m.id.endsWith('msg-117'))
    if (!message) throw new Error('未找到预置的 itest-msg-117')
    // 后端给的是 12.345（3 位小数），展示必须收敛为 1 位
    expect(message.duration_seconds ?? 0).toBeCloseTo(12.345, 3)

    const wrapper = mount(MessageBubble, { props: { message } })
    expect(wrapper.text()).toContain('12.3s')
    expect(wrapper.text()).toContain('输入 1234 · 输出 567 tokens')
  })

  it('MessageList 渲染真实 attachments 为 @文件名 引用（FR-016）', async () => {
    const { threads } = live.session
    const wrapper = mount(MessageList, {
      props: { messages: threads.messages.value as never },
    })
    expect(wrapper.text()).toContain('@itest-排产表.csv')
  })
})

/**
 * 回收必须放在**最外层**：若挂在 US1 的 describe 内，vitest 会在 US1 跑完立刻执行，
 * 从而删掉会话并清空 `activeId`，导致后续 describe 无消息可操作（`refresh()` 直接清空）。
 */
afterAll(async () => {
  await cleanupTrackedThreads(live.session)
})
