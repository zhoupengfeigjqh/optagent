import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RUN_PHASE } from '../constants/events'
import { createChatStreamStore } from './useChatStream'
import type { ChatStreamDeps } from './useChatStream.types'

function controlledFetch(): {
  fetchImpl: typeof fetch
  push: (chunk: string) => void
  close: () => void
} {
  let push: (chunk: string) => void = () => undefined
  let close: () => void = () => undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk: string): void => controller.enqueue(new TextEncoder().encode(chunk))
      close = (): void => controller.close()
    },
  })
  return {
    fetchImpl: (async () =>
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })) as unknown as typeof fetch,
    push: (chunk: string) => push(chunk),
    close: () => close(),
  }
}

function makeDeps(fetchImpl: typeof fetch): ChatStreamDeps {
  return { activeThreadId: ref('th_1'), getModel: () => null, storage: null, fetchImpl }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const sse = (event: string, data: Record<string, unknown>): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

const DONE = sse('done', {
  finish_reason: 'completed',
  duration_seconds: 1,
  message_id: 'm_1',
  agent_name: '生鲜识别辅助',
})

describe('useChatStream —— 流式渲染段（A-lite）', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('文字 → 工具 → 文字：段序与事件到达顺序一致，且工具后的正文另起一段', async () => {
    const { fetchImpl, push } = controlledFetch()
    const store = createChatStreamStore(makeDeps(fetchImpl))

    void store.send({ content: '解析订单', attachments: [] })
    await flush()

    push(sse('content', { delta: '我先读一下技能。' }))
    await flush()
    push(
      sse('tool_call', {
        call_id: 'c1',
        name: 'fresh__fresh_order_parse',
        label: '生鲜订单解析',
        status: 'running',
      }),
    )
    await flush()
    push(sse('content', { delta: '解析完成，共 3 行。' }))
    await flush()

    expect(store.segments.value.map((s) => s.kind)).toEqual(['text', 'tool', 'text'])
    const first = store.segments.value[0]
    const third = store.segments.value[2]
    expect(first?.kind === 'text' ? first.text : '').toBe('我先读一下技能。')
    expect(third?.kind === 'text' ? third.text : '').toBe('解析完成，共 3 行。')
    // flip 掉的旧口径：正文一律拼进同一段（历史渲染顺序），这里必须已分家
    expect(store.streamingText.value).toBe('我先读一下技能。解析完成，共 3 行。')
  })

  it('连续正文增量续写同一段，不产生碎片段', async () => {
    const { fetchImpl, push } = controlledFetch()
    const store = createChatStreamStore(makeDeps(fetchImpl))

    void store.send({ content: '你好', attachments: [] })
    await flush()

    push(sse('content', { delta: '你' }))
    await flush()
    push(sse('content', { delta: '好' }))
    await flush()
    push(sse('content', { delta: '呀' }))
    await flush()

    expect(store.segments.value).toHaveLength(1)
    const only = store.segments.value[0]
    expect(only?.kind === 'text' ? only.text : '').toBe('你好呀')
  })

  it('tool_call_end 只改段内状态，不改变段位置', async () => {
    const { fetchImpl, push } = controlledFetch()
    const store = createChatStreamStore(makeDeps(fetchImpl))

    void store.send({ content: '解析订单', attachments: [] })
    await flush()

    push(sse('tool_call', { call_id: 'c1', name: 'read_file', label: '读取文件' }))
    await flush()
    push(sse('content', { delta: '读完了。' }))
    await flush()
    push(sse('tool_call_end', { call_id: 'c1', status: 'success' }))
    await flush()

    expect(store.segments.value.map((s) => s.kind)).toEqual(['tool', 'text'])
    const tool = store.segments.value[0]
    expect(tool?.kind === 'tool' ? tool.call.status : '').toBe('success')
    expect(store.toolCalls.value[0]?.status).toBe('success')
  })

  it('本轮收口（done → finally）：段序清空，交给历史消息接管', async () => {
    const { fetchImpl, push, close } = controlledFetch()
    const store = createChatStreamStore(makeDeps(fetchImpl))

    void store.send({ content: '你好', attachments: [] })
    await flush()
    push(sse('content', { delta: '答' }))
    await flush()
    expect(store.segments.value).toHaveLength(1)

    push(DONE)
    close()
    await flush()
    await flush()

    expect(store.phase.value).toBe(RUN_PHASE.COMPLETED)
    expect(store.segments.value).toEqual([])
  })

  it('reset()（切会话）：段序清空，不泄漏到新会话', async () => {
    const { fetchImpl, push } = controlledFetch()
    const store = createChatStreamStore(makeDeps(fetchImpl))

    void store.send({ content: '你好', attachments: [] })
    await flush()
    push(sse('content', { delta: '答' }))
    await flush()
    expect(store.segments.value).toHaveLength(1)

    store.reset()

    expect(store.segments.value).toEqual([])
  })

  it('新一轮发送：清空上一轮残留的段序', async () => {
    const { fetchImpl, push } = controlledFetch()
    const store = createChatStreamStore(makeDeps(fetchImpl))

    void store.send({ content: '第一轮', attachments: [] })
    await flush()
    push(sse('content', { delta: '旧内容' }))
    await flush()
    store.reset()
    expect(store.segments.value).toEqual([])

    void store.send({ content: '第二轮', attachments: [] })
    await flush()
    expect(store.segments.value).toEqual([])
  })
})
