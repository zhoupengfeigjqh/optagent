import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RUN_PHASE } from '../constants/events'
import { createChatStreamStore } from './useChatStream'
import type { ChatStreamDeps } from './useChatStream.types'

const PENDING_FETCH = (async () =>
  new Response(new ReadableStream<Uint8Array>({ start() {} }), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })) as unknown as typeof fetch

function controlledFetch(): { fetchImpl: typeof fetch; push: (chunk: string) => void } {
  let push: (chunk: string) => void = () => undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk: string): void => controller.enqueue(new TextEncoder().encode(chunk))
    },
  })
  return {
    fetchImpl: (async () =>
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })) as unknown as typeof fetch,
    push: (chunk: string) => push(chunk),
  }
}

function scriptedFetch(script: string): typeof fetch {
  return (async () =>
    new Response(new TextEncoder().encode(script), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })) as unknown as typeof fetch
}

function makeDeps(fetchImpl: typeof fetch): ChatStreamDeps {
  return { activeThreadId: ref('th_1'), getModel: () => null, storage: null, fetchImpl }
}

const DONE_SCRIPT = [
  'event: done',
  'data: {"finish_reason":"completed","duration_seconds":1,"message_id":"m_1","agent_name":"生鲜识别辅助"}',
  '',
  '',
].join('\n')

const INTERACTION_SCRIPT =
  'event: interaction_request\n' +
  'data: {"interaction_id":"i_1","call_id":"c_1","tool_name":"t_1","title":"确认调用参数","schema":{"type":"object","properties":{}},"proposed_args":{},"required":[],"timeout_seconds":300}\n\n'

describe('useChatStream —— 静默心跳兜底（TR-66）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('挂起超过阈值（2.5s）：stalled 置位', () => {
    const store = createChatStreamStore(makeDeps(PENDING_FETCH))

    void store.send({ content: '解析这张订单', attachments: [] })

    vi.advanceTimersByTime(2000)
    expect(store.stalled.value).toBe(false)

    vi.advanceTimersByTime(1000)
    expect(store.phase.value).toBe(RUN_PHASE.STREAMING)
    expect(store.stalled.value).toBe(true)
  })

  it('事件到达即回落：正文一开始流，就不再显示「模型正在思考…」', async () => {
    const { fetchImpl, push } = controlledFetch()
    const store = createChatStreamStore(makeDeps(fetchImpl))

    void store.send({ content: '解析这张订单', attachments: [] })
    await vi.advanceTimersByTimeAsync(3000)
    expect(store.stalled.value).toBe(true)

    push('event: content\ndata: {"delta":"好的"}\n\n')
    await vi.advanceTimersByTimeAsync(0)

    expect(store.streamingText.value).toBe('好的')
    expect(store.stalled.value).toBe(false)
  })

  it('本轮终结（done）：停表，之后再推进时间也不置位', async () => {
    const store = createChatStreamStore(makeDeps(scriptedFetch(DONE_SCRIPT)))

    await store.send({ content: '你好', attachments: [] })

    expect(store.phase.value).toBe(RUN_PHASE.COMPLETED)
    vi.advanceTimersByTime(5000)
    expect(store.stalled.value).toBe(false)
  })

  it('reset()（切会话/新建会话）：停表且不残留', () => {
    const store = createChatStreamStore(makeDeps(PENDING_FETCH))

    void store.send({ content: '解析这张订单', attachments: [] })
    vi.advanceTimersByTime(3000)
    expect(store.stalled.value).toBe(true)

    store.reset()

    expect(store.stalled.value).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(store.stalled.value).toBe(false)
  })

  it('HITL 挂起不算静默：等用户确认时不显示「正在思考」', async () => {
    // 流必须保持挂起：若脚本吐完，`send()` 会把"无终结事件的断流"判成 failed 并清掉弹窗
    const { fetchImpl, push } = controlledFetch()
    const store = createChatStreamStore(makeDeps(fetchImpl))

    void store.send({ content: '提交排程', attachments: [] })
    push(INTERACTION_SCRIPT)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.pendingInteraction.value).not.toBeNull()

    vi.advanceTimersByTime(5000)
    expect(store.stalled.value).toBe(false)
  })
})
