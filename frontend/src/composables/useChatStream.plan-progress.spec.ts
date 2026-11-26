import { ref } from 'vue'
import { describe, expect, it } from 'vitest'

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

const progress = (seqId: number, label: string, phase: string): string =>
  sse('plan_progress', { seq_id: seqId, label, phase })

const DONE = sse('done', {
  finish_reason: 'completed',
  duration_seconds: 1,
  message_id: 'm_1',
  agent_name: '生产调度测试',
})

describe('useChatStream —— 计划进度（028 FR-034）', () => {
  it('running → 步推进 → done：按 seqId 累积，重规划同号原地替换', async () => {
    const { fetchImpl, push } = controlledFetch()
    const store = createChatStreamStore(makeDeps(fetchImpl))

    void store.send({ content: '查库存', attachments: [] })
    await flush()

    push(progress(1, '查询库存', 'running'))
    await flush()
    push(progress(2, '创建采购', 'running'))
    await flush()
    // 重规划：同一编号被改写，MUST NOT 出现两行
    push(progress(2, '创建采购（补供应商）', 'replanned'))
    await flush()
    push(progress(2, '创建采购（补供应商）', 'done'))
    await flush()
    push(DONE)
    await flush()

    expect(store.planProgress.value).toEqual([
      { seqId: 1, label: '查询库存', phase: 'running' },
      { seqId: 2, label: '创建采购（补供应商）', phase: 'done' },
    ])
  })

  it('缺 label 的事件直接丢弃（不出现空白一行）', async () => {
    const { fetchImpl, push } = controlledFetch()
    const store = createChatStreamStore(makeDeps(fetchImpl))

    void store.send({ content: '查库存', attachments: [] })
    await flush()

    push(sse('plan_progress', { seq_id: 1, label: '', phase: 'running' }))
    await flush()

    expect(store.planProgress.value).toEqual([])
  })

  it('下一次发送清空上一轮进度（进度不跨轮、不进历史）', async () => {
    const first = controlledFetch()
    const deps = makeDeps(first.fetchImpl)
    const store = createChatStreamStore(deps)

    void store.send({ content: '第一轮', attachments: [] })
    await flush()
    first.push(progress(1, '查询库存', 'running'))
    await flush()
    first.push(DONE)
    await flush()
    expect(store.planProgress.value).toHaveLength(1)

    // 换一个 fetch，模拟第二次发送
    const second = controlledFetch()
    deps.fetchImpl = second.fetchImpl
    void store.send({ content: '第二轮', attachments: [] })
    await flush()

    expect(store.planProgress.value).toEqual([])
  })

  it('reset（切会话）清空进度', async () => {
    const { fetchImpl, push } = controlledFetch()
    const store = createChatStreamStore(makeDeps(fetchImpl))

    void store.send({ content: '查库存', attachments: [] })
    await flush()
    push(progress(1, '查询库存', 'running'))
    await flush()
    expect(store.planProgress.value).toHaveLength(1)

    store.reset()

    expect(store.planProgress.value).toEqual([])
  })
})
