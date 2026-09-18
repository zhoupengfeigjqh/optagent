/**
 * 单元测试：中断轮的用户可感知收口（2026-09-18）。
 *
 * 背景：中断轮不落盘（FR-007），用户消息与 partial 回答都从历史消失，
 * 前端需要在不破坏任何既有语义的前提下补齐体验：
 * - 中断气泡标识「已停止生成」，并以 `lastAbortedTurn` 提供「重新生成」；
 * - `/stop` 失败（本地已停、远端未知）必须 toast 可感知（宪章原则九）。
 *
 * 不变式（本文件守住）：
 * - 中断轮缓存只在前端、不落盘，不改变 FR-007 的任何持久化语义；
 * - `regenerate()` 复用 `send()` 全链路（乐观气泡、并发、终结事件收口）；
 * - `stop()` 的本地中止时序不变：abort 先于 await，点完立刻停。
 */
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { RUN_PHASE } from '../constants/events'
import { createChatStreamStore, type ChatStreamDeps } from './useChatStream'

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
    fetchImpl: PENDING_FETCH,
    ...overrides,
  }
}

const flush = (): Promise<void> => Promise.resolve().then(() => Promise.resolve())

describe('useChatStream —— 中断轮「重新生成」与可感知收口', () => {
  it('手动中断：用户消息抢救进 lastAbortedTurn（内容与原引用原样保留）', async () => {
    const store = createChatStreamStore(makeDeps())
    const attachments = [{ dir: '临时空间', filename: '计划.csv' }]

    const pending = store.send({ content: '帮我看看这份计划', attachments })
    await flush()
    await store.stop()
    await pending

    expect(store.phase.value).toBe(RUN_PHASE.ABORTED)
    expect(store.lastAbortedTurn.value).toEqual({
      content: '帮我看看这份计划',
      attachments,
    })
  })

  it('regenerate()：以缓存重发一轮，进入 STREAMING 且乐观气泡复现；新轮取代旧缓存', async () => {
    const store = createChatStreamStore(makeDeps())

    const first = store.send({ content: '你好', attachments: [] })
    await flush()
    await store.stop()
    await first
    expect(store.lastAbortedTurn.value).not.toBeNull()

    const second = store.regenerate()
    await flush()

    expect(store.phase.value).toBe(RUN_PHASE.STREAMING)
    expect(store.pendingUserMessage.value).toEqual({ content: '你好', attachments: [] })
    // 新一轮发送即清除旧缓存，避免「重新生成」按钮残留到本轮回合
    expect(store.lastAbortedTurn.value).toBeNull()

    await store.stop()
    await second
    // 重新生成后又被中断：缓存按本轮回滚重新置位
    expect(store.lastAbortedTurn.value).toEqual({ content: '你好', attachments: [] })
  })

  it('正常完成的轮次不留下中断缓存', async () => {
    const DONE_SCRIPT = [
      'event: done',
      'data: {"finish_reason":"completed","usage":{"input_tokens":1,"output_tokens":2},"duration_seconds":0.5,"message_id":"m_1","agent_name":"demo"}',
      '',
      '',
    ].join('\n')
    const doneFetch = (async () =>
      new Response(DONE_SCRIPT, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })) as unknown as typeof fetch
    const store = createChatStreamStore(makeDeps({ fetchImpl: doneFetch }))

    await store.send({ content: '你好', attachments: [] })

    expect(store.phase.value).toBe(RUN_PHASE.COMPLETED)
    expect(store.lastAbortedTurn.value).toBeNull()
  })

  it('中断后切换会话（reset）：缓存清除，不泄漏到新会话', async () => {
    const store = createChatStreamStore(makeDeps())

    const pending = store.send({ content: '你好', attachments: [] })
    await flush()
    store.reset()
    await pending

    expect(store.lastAbortedTurn.value).toBeNull()
  })

  it('stop() 的 /stop 请求失败：本地仍立即中止，但 toast 提示远端状态未知', async () => {
    const push = vi.fn()
    const store = createChatStreamStore(
      makeDeps({
        stopRun: () => Promise.reject(new Error('connect ECONNREFUSED')),
        toast: { push } as never,
      }),
    )

    const pending = store.send({ content: '你好', attachments: [] })
    await flush()
    // 本地中止时序不变：点完即停，不等待 /stop 结果
    await store.stop()
    await pending

    expect(store.phase.value).toBe(RUN_PHASE.ABORTED)
    expect(push).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('远端运行状态未知'),
    )
  })

  it('stop() 正常返回（含 stopped=false 幂等场景）：不弹错误提示', async () => {
    const push = vi.fn()
    const store = createChatStreamStore(
      makeDeps({
        stopRun: () => Promise.resolve(),
        toast: { push } as never,
      }),
    )

    const pending = store.send({ content: '你好', attachments: [] })
    await flush()
    await store.stop()
    await pending

    expect(push).not.toHaveBeenCalled()
  })
})
