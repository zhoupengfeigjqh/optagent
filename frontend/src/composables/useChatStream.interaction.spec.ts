/**
 * 单元测试：聊天流 × 工具调用人工确认（HITL）。
 *
 * 守住：
 * - SSE `interaction_request` 事件 → `pendingInteraction` 置位（含全量倒计时）
 * - done / error / stop / 切换会话 → 清除（弹窗不残留）
 * - submitInteraction：成功关闭；服务端终验失败返回 close=false + 错误（保持弹窗）；
 *   其他错误 toast 并关闭；rejectInteraction 始终关闭
 * - restoreInteraction：断连恢复快照（不覆盖已存在的）
 */
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { RUN_PHASE } from '../constants/events'
import { createChatStreamStore, type ChatStreamDeps } from './useChatStream'
import { createToastStore } from './useToast'

const INTERACTION_EVENT = [
  'event: interaction_request',
  'data: {"interaction_id":"i_1","call_id":"c1","tool_name":"svc__query","title":"确认调用参数：svc__query","schema":{"type":"object","properties":{"n":{"type":"integer"}},"required":["n"]},"proposed_args":{"n":1},"required":["n"],"timeout_seconds":120}',
  '',
].join('\n')

const DONE_AFTER_INTERACTION = [
  INTERACTION_EVENT,
  'event: content',
  'data: {"delta":"完成"}',
  '',
  'event: done',
  'data: {"finish_reason":"completed","usage":{"input_tokens":1,"output_tokens":2},"duration_seconds":1,"message_id":"m_1","agent_name":"demo"}',
  '',
  '',
].join('\n')

function sseFetch(script: string): typeof fetch {
  return (async () =>
    new Response(script, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })) as unknown as typeof fetch
}

function makeDeps(overrides: Partial<ChatStreamDeps> = {}): ChatStreamDeps {
  return {
    activeThreadId: ref('th_1'),
    getModel: () => null,
    storage: null,
    fetchImpl: sseFetch(DONE_AFTER_INTERACTION),
    ...overrides,
  }
}

describe('useChatStream —— HITL 人工确认', () => {
  it('interaction_request 事件 → pendingInteraction 置位（含全量倒计时）', async () => {
    // 发出事件后流保持挂起（模拟等待用户确认），验证置位时机与倒计时起点
    const hanging = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(INTERACTION_EVENT + '\n'))
            // 不 close：等待用户确认期间流一直开着
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )) as unknown as typeof fetch
    const store = createChatStreamStore(makeDeps({ fetchImpl: hanging }))

    const sending = store.send({ content: '查一下', attachments: [] })
    await new Promise((r) => setTimeout(r, 20))

    expect(store.phase.value).toBe(RUN_PHASE.STREAMING)
    expect(store.pendingInteraction.value).toMatchObject({
      interaction_id: 'i_1',
      tool_name: 'svc__query',
      proposed_args: { n: 1 },
      remaining_seconds: 120, // 从全量 timeout 起算
    })

    await store.stop()
    await sending
  })

  it('done 终结后 pendingInteraction 清除（弹窗不残留）', async () => {
    const store = createChatStreamStore(makeDeps())

    await store.send({ content: '查一下', attachments: [] })

    expect(store.phase.value).toBe(RUN_PHASE.COMPLETED)
    expect(store.pendingInteraction.value).toBeNull()
  })

  it('stop 中断 → pendingInteraction 清除', async () => {
    const store = createChatStreamStore(
      makeDeps({
        fetchImpl: (async () =>
          new Response(new ReadableStream<Uint8Array>({ start() {} }), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })) as unknown as typeof fetch,
      }),
    )
    store.restoreInteraction({
      interaction_id: 'i_7',
      call_id: 'c1',
      tool_name: 'svc__t',
      title: 't',
      schema: { type: 'object', properties: {} },
      proposed_args: {},
      required: [],
      timeout_seconds: 300,
      remaining_seconds: 10,
    })

    const sending = store.send({ content: '查一下', attachments: [] })
    await new Promise((r) => setTimeout(r, 10))
    await store.stop()
    await sending

    expect(store.pendingInteraction.value).toBeNull()
    expect(store.phase.value).toBe(RUN_PHASE.ABORTED)
  })

  it('submitInteraction：成功 → 关闭并调 API（interaction_id + args）', async () => {
    const submitInteraction = vi.fn().mockResolvedValue({ accepted: true, result: 'settled' })
    const store = createChatStreamStore(makeDeps({ submitInteraction }))

    await store.send({ content: '查一下', attachments: [] })
    // 直接恢复一个快照模拟弹窗打开
    store.restoreInteraction({
      interaction_id: 'i_9',
      call_id: 'c1',
      tool_name: 'svc__query',
      title: '确认调用参数：svc__query',
      schema: { type: 'object', properties: {} },
      proposed_args: {},
      required: [],
      timeout_seconds: 300,
      remaining_seconds: 280,
    })
    expect(store.pendingInteraction.value?.interaction_id).toBe('i_9')

    const result = await store.submitInteraction({ n: 5 })

    expect(submitInteraction).toHaveBeenCalledWith('th_1', {
      interaction_id: 'i_9',
      action: 'submit',
      args: { n: 5 },
    })
    expect(result).toEqual({ close: true })
    expect(store.pendingInteraction.value).toBeNull()
  })

  it('submitInteraction：服务端终验失败 → close=false + 逐字段错误，弹窗保持', async () => {
    const submitInteraction = vi.fn().mockRejectedValue({
      code: 'SCHEMA_VALIDATION_FAILED',
      message: '参数「n」须为整数',
    })
    const store = createChatStreamStore(makeDeps({ submitInteraction }))
    store.restoreInteraction({
      interaction_id: 'i_x',
      call_id: 'c1',
      tool_name: 'svc__t',
      title: 't',
      schema: { type: 'object', properties: {} },
      proposed_args: {},
      required: [],
      timeout_seconds: 300,
      remaining_seconds: 10,
    })

    const result = await store.submitInteraction({ n: 'abc' })

    expect(result.close).toBe(false)
    expect(result.message).toContain('须为整数')
    expect(store.pendingInteraction.value?.interaction_id).toBe('i_x') // 保持挂起可重提
  })

  it('submitInteraction：其他错误（如已超时）→ toast 提示并关闭弹窗', async () => {
    const submitInteraction = vi.fn().mockRejectedValue({
      code: 'INTERACTION_EXPIRED',
      message: '已超时',
    })
    const toast = createToastStore()
    const push = vi.spyOn(toast, 'push')
    const store = createChatStreamStore(makeDeps({ submitInteraction, toast }))
    store.restoreInteraction({
      interaction_id: 'i_y',
      call_id: 'c1',
      tool_name: 'svc__t',
      title: 't',
      schema: { type: 'object', properties: {} },
      proposed_args: {},
      required: [],
      timeout_seconds: 300,
      remaining_seconds: 0,
    })

    const result = await store.submitInteraction({ n: 1 })

    expect(result).toEqual({ close: true })
    expect(store.pendingInteraction.value).toBeNull()
    expect(push).toHaveBeenCalled()
  })

  it('submitInteraction：未注入 API（防御）→ 直接关闭', async () => {
    const store = createChatStreamStore(makeDeps())
    store.restoreInteraction({
      interaction_id: 'i_z',
      call_id: 'c1',
      tool_name: 'svc__t',
      title: 't',
      schema: { type: 'object', properties: {} },
      proposed_args: {},
      required: [],
      timeout_seconds: 300,
      remaining_seconds: 5,
    })
    const result = await store.submitInteraction({ n: 1 })
    expect(result).toEqual({ close: true })
  })

  it('rejectInteraction：调用 API 并关闭', async () => {
    const submitInteraction = vi.fn().mockResolvedValue({ accepted: true, result: 'settled' })
    const store = createChatStreamStore(makeDeps({ submitInteraction }))

    store.restoreInteraction({
      interaction_id: 'i_8',
      call_id: 'c1',
      tool_name: 'svc__t',
      title: 't',
      schema: { type: 'object', properties: {} },
      proposed_args: {},
      required: [],
      timeout_seconds: 300,
      remaining_seconds: 10,
    })
    await store.rejectInteraction()

    expect(submitInteraction).toHaveBeenCalledWith('th_1', {
      interaction_id: 'i_8',
      action: 'reject',
    })
    expect(store.pendingInteraction.value).toBeNull()
  })

  it('restoreInteraction：不覆盖已存在的 pendingInteraction', () => {
    const store = createChatStreamStore(makeDeps())
    store.restoreInteraction({
      interaction_id: 'i_1',
      call_id: 'c1',
      tool_name: 'svc__t',
      title: 't',
      schema: { type: 'object', properties: {} },
      proposed_args: {},
      required: [],
      timeout_seconds: 300,
      remaining_seconds: 10,
    })
    store.restoreInteraction({
      interaction_id: 'i_2',
      call_id: 'c2',
      tool_name: 'svc__u',
      title: 'u',
      schema: { type: 'object', properties: {} },
      proposed_args: {},
      required: [],
      timeout_seconds: 300,
      remaining_seconds: 10,
    })
    expect(store.pendingInteraction.value?.interaction_id).toBe('i_1')
  })
})
