/**
 * 单元测试：本轮运行状态机的乐观用户气泡（2026-09-16 十七次调整）。
 *
 * 回归的 bug：历史刷新（`onTurnFinished`）只在流**完成后**触发，而发送路径没有任何
 * 本地插入——导致"发送后要等 AI 答完，自己的消息才显示"。
 *
 * 不变式（本文件守住）：
 * - 发送即置位（流进行中即可见），内容与引用原样保留；
 * - 完成 / 失败 / 中断 / 切换会话，全部清除（MUST NOT 与历史真身重复渲染）。
 */
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { RUN_PHASE } from '../constants/events'
import { createChatStreamStore, type ChatStreamDeps } from './useChatStream'

/**
 * 已完成轮次的 SSE 脚本：一段正文 + done（message_id 非 null ⇒ completed）。
 * 注意：SSE 事件 MUST 以**空行**收尾（后端 `end()` 前会补空行），
 * 故脚本末尾保留两个空串元素以产生结尾的 `\n\n`。
 */
const DONE_SCRIPT = [
  'event: content',
  'data: {"delta":"你好"}',
  '',
  'event: done',
  'data: {"finish_reason":"completed","usage":{"input_tokens":1,"output_tokens":2},"duration_seconds":1.2,"message_id":"m_1","agent_name":"demo"}',
  '',
  '',
].join('\n')

/** 返回按给定 SSE 脚本应答的 fetch 假实现 */
function sseFetch(script: string): typeof fetch {
  return (async () =>
    new Response(script, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })) as unknown as typeof fetch
}

/** 永不吐数据的挂起流（模拟"AI 还在长时间作答中"） */
const PENDING_FETCH = (async () =>
  new Response(new ReadableStream<Uint8Array>({ start() {} }), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })) as unknown as typeof fetch

function makeDeps(overrides: Partial<ChatStreamDeps> = {}): ChatStreamDeps {
  return {
    activeThreadId: ref('th_1'),
    getModel: () => null,
    storage: null,
    fetchImpl: sseFetch(DONE_SCRIPT),
    ...overrides,
  }
}

const flush = (): Promise<void> => Promise.resolve().then(() => Promise.resolve())

describe('useChatStream —— 乐观用户气泡（十七次调整）', () => {
  it('发送即置位：流进行中 pendingUserMessage 已可见，内容与引用原样保留', async () => {
    const store = createChatStreamStore(makeDeps({ fetchImpl: PENDING_FETCH }))
    const attachments = [{ dir: '临时空间', filename: '计划.csv' }]

    const pending = store.send({ content: '帮我看看这份计划', attachments })
    await flush()

    expect(store.phase.value).toBe(RUN_PHASE.STREAMING)
    expect(store.pendingUserMessage.value).toEqual({
      content: '帮我看看这份计划',
      attachments,
    })

    void store.stop()
    await pending
  })

  it('流完成：pendingUserMessage 清除（历史真身经 onTurnFinished 接管，不重复渲染）', async () => {
    const onTurnFinished = vi.fn()
    const store = createChatStreamStore(makeDeps({ onTurnFinished }))

    await store.send({ content: '你好', attachments: [] })

    expect(store.phase.value).toBe(RUN_PHASE.COMPLETED)
    expect(onTurnFinished).toHaveBeenCalledWith('th_1')
    expect(store.pendingUserMessage.value).toBeNull()
  })

  it('发送失败（网络异常）：pendingUserMessage 清除，维持既有"还原草稿"降级语义', async () => {
    const failing = (async () => {
      throw new Error('connect ECONNREFUSED')
    }) as unknown as typeof fetch
    const store = createChatStreamStore(makeDeps({ fetchImpl: failing }))

    await store.send({ content: '你好', attachments: [] })

    expect(store.phase.value).toBe(RUN_PHASE.FAILED)
    expect(store.error.value?.code).toBe('NETWORK_ERROR')
    expect(store.pendingUserMessage.value).toBeNull()
  })

  it('手动中断：pendingUserMessage 随流一并清除（中断轮不落盘，与既有口径一致）', async () => {
    const store = createChatStreamStore(makeDeps({ fetchImpl: PENDING_FETCH }))

    const pending = store.send({ content: '你好', attachments: [] })
    await flush()
    expect(store.pendingUserMessage.value).not.toBeNull()

    await store.stop()
    await pending

    expect(store.phase.value).toBe(RUN_PHASE.ABORTED)
    expect(store.pendingUserMessage.value).toBeNull()
  })

  it('切换会话（reset）：残留的乐观气泡清除，不泄漏到新会话', async () => {
    const store = createChatStreamStore(makeDeps({ fetchImpl: PENDING_FETCH }))

    const pending = store.send({ content: '你好', attachments: [] })
    await flush()
    store.reset()
    await pending

    // 不变式是"气泡清除、不泄漏到新会话"；相位由在途流的 AbortError 收口为
    // ABORTED（reset 只负责同步清态，不等待在途流）——此为既有语义，不在本调整范围
    expect(store.pendingUserMessage.value).toBeNull()
    expect(store.phase.value).toBe(RUN_PHASE.ABORTED)
  })
})
