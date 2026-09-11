import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import type { FeedbackValue } from '../api/types'
import { STORAGE_KEY_THINKING } from '../constants/limits'
import {
  createFetchRouter,
  errorResponse,
  flush,
  memoryStorage,
  sseFrame,
  sseResponse,
} from '../../tests/helpers'
import { createChatStreamStore } from './useChatStream'
import { createToastStore } from './useToast'

const SEND_PATH = 'POST /api/threads/t1/messages'

/** 手动可控的 SSE 流，用于断言"进行中"状态。 */
function openStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(inner) {
      controller = inner
    },
  })
  const encoder = new TextEncoder()
  return {
    stream,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  }
}

function makeChat(
  routes: Parameters<typeof createFetchRouter>[0],
  options: { storage?: Storage; model?: string | null; agentName?: string | null } = {},
) {
  const router = createFetchRouter(routes)
  const activeThreadId = ref<string | null>('t1')
  const model = ref<string | null>(options.model === undefined ? 'qwen-max' : options.model)
  const agentName = ref<string | null>(options.agentName ?? 'ops')
  const stopped: string[] = []
  const finished: string[] = []
  const storage = options.storage ?? memoryStorage()
  const toast = createToastStore()

  const chat = createChatStreamStore({
    activeThreadId,
    getModel: () => model.value,
    getAgentName: () => agentName.value,
    stopRun: async (id) => {
      stopped.push(id)
    },
    onTurnFinished: async (id) => {
      finished.push(id)
    },
    toast,
    storage,
    fetchImpl: router.fetch,
  })

  return { chat, router, activeThreadId, model, agentName, stopped, finished, storage, toast }
}

const DONE_COMPLETED = {
  finish_reason: 'completed',
  usage: { input_tokens: 12, output_tokens: 34 },
  duration_seconds: 4.218,
  message_id: 'm-new',
  agent_name: 'ops',
}

describe('useChatStream - 事件累积（FR-005、FR-020）', () => {
  it('thinking 与 content 增量累积到各自 ref', async () => {
    const { chat } = makeChat({
      [SEND_PATH]: () =>
        sseResponse([
          sseFrame('thinking', { delta: '先想' }),
          sseFrame('thinking', { delta: '再想' }),
          sseFrame('content', { delta: '你' }),
          sseFrame('content', { delta: '好' }),
          sseFrame('done', DONE_COMPLETED),
        ]),
    })
    chat.draft.value = 'hi'

    await chat.send({ content: 'hi', attachments: [] })

    expect(chat.streamingThinking.value).toBe('先想再想')
    expect(chat.streamingText.value).toBe('你好')
    expect(chat.phase.value).toBe('completed')
  })

  it('tool_call 入队、tool_call_end 出队（V-05：结束后立即消失）', async () => {
    const { stream, push, close } = openStream()
    const { chat } = makeChat({ [SEND_PATH]: () => new Response(stream) })
    chat.draft.value = 'hi'

    const task = chat.send({ content: 'hi', attachments: [] })
    await flush()

    // 两次 tool_call 依次入队
    push(sseFrame('tool_call', { call_id: 'c1', name: 'read_file', status: 'running' }))
    await flush()
    push(sseFrame('tool_call', { call_id: 'c2', name: 'solve', status: 'running' }))
    await flush()
    expect(chat.toolCalls.value.map((item) => item.name)).toEqual(['read_file', 'solve'])

    // 结束一个即出队一个
    push(sseFrame('tool_call_end', { call_id: 'c1', status: 'success' }))
    await flush()
    expect(chat.toolCalls.value.map((item) => item.name)).toEqual(['solve'])

    push(sseFrame('tool_call_end', { call_id: 'c2', status: 'success' }))
    await flush()
    expect(chat.toolCalls.value).toEqual([])

    push(sseFrame('done', DONE_COMPLETED))
    close()
    await task
  })

  it('工具项在结束前保持 running 状态', async () => {
    const { stream, push, close } = openStream()
    const { chat } = makeChat({ [SEND_PATH]: () => new Response(stream) })
    chat.draft.value = 'hi'

    const task = chat.send({ content: 'hi', attachments: [] })
    await flush()

    push(sseFrame('tool_call', { call_id: 'c1', name: 'read_file', status: 'running' }))
    await flush()
    expect(chat.toolCalls.value).toEqual([
      { call_id: 'c1', name: 'read_file', status: 'running' },
    ])

    push(sseFrame('tool_call_end', { call_id: 'c1', status: 'error' }))
    await flush()
    expect(chat.toolCalls.value).toEqual([])

    push(sseFrame('done', DONE_COMPLETED))
    close()
    await task
  })

  it('未知事件被忽略且不中断流', async () => {
    const { chat } = makeChat({
      [SEND_PATH]: () =>
        sseResponse([
          sseFrame('content', { delta: 'a' }),
          sseFrame('unknown_event', { x: 1 }),
          sseFrame('content', { delta: 'b' }),
          sseFrame('done', DONE_COMPLETED),
        ]),
    })
    chat.draft.value = 'hi'

    await chat.send({ content: 'hi', attachments: [] })

    expect(chat.streamingText.value).toBe('ab')
    expect(chat.phase.value).toBe('completed')
  })
})

describe('useChatStream - 终结与状态机（FR-007、FR-021~FR-023）', () => {
  it('streamingAgentName：发送时快照当前数字人，done 事件落定为后端返回值', async () => {
    const { stream, push, close } = openStream()
    const { chat } = makeChat({ [SEND_PATH]: () => new Response(stream) }, { agentName: 'analyst' })
    chat.draft.value = 'hi'

    const task = chat.send({ content: 'hi', attachments: [] })
    await flush()

    // 流式期间取发送时的快照（会话可跨数字人：相邻两轮可能不同）
    expect(chat.streamingAgentName.value).toBe('analyst')

    push(sseFrame('done', DONE_COMPLETED))
    close()
    await task

    // 收尾后以后端 done 事件为准
    expect(chat.streamingAgentName.value).toBe('ops')
  })

  it('done(completed) 记录用量与耗时并刷新会话', async () => {
    const { chat, finished } = makeChat({
      [SEND_PATH]: () => sseResponse([sseFrame('done', DONE_COMPLETED)]),
    })
    chat.draft.value = 'hi'

    await chat.send({ content: 'hi', attachments: [] })

    expect(chat.usage.value).toEqual({ input_tokens: 12, output_tokens: 34 })
    expect(chat.durationSeconds.value).toBeCloseTo(4.218)
    expect(finished).toEqual(['t1'])
  })

  it('done(message_id 为 null) ⇒ aborted，且不刷新会话（本轮不落盘）', async () => {
    const { chat, finished } = makeChat({
      [SEND_PATH]: () =>
        sseResponse([
          sseFrame('content', { delta: '半句' }),
          sseFrame('done', { ...DONE_COMPLETED, finish_reason: 'stop', message_id: null }),
        ]),
    })
    chat.draft.value = 'hi'

    await chat.send({ content: 'hi', attachments: [] })

    expect(chat.phase.value).toBe('aborted')
    expect(finished).toEqual([])
  })

  it('error 事件 ⇒ failed 并记录错误码', async () => {
    const { chat } = makeChat({
      [SEND_PATH]: () =>
        sseResponse([
          sseFrame('content', { delta: 'x' }),
          sseFrame('error', { error: { code: 'MODEL_NOT_FOUND', message: 'gone' } }),
        ]),
    })
    chat.draft.value = 'hi'

    await chat.send({ content: 'hi', attachments: [] })

    expect(chat.phase.value).toBe('failed')
    expect(chat.error.value?.code).toBe('MODEL_NOT_FOUND')
  })

  it('流结束但无终结事件 ⇒ failed（连接中断）', async () => {
    const { chat } = makeChat({
      [SEND_PATH]: () => sseResponse([sseFrame('content', { delta: 'x' })]),
    })
    chat.draft.value = 'hi'

    await chat.send({ content: 'hi', attachments: [] })

    expect(chat.phase.value).toBe('failed')
    expect(chat.error.value?.code).toBe('NETWORK_ERROR')
  })

  it('HTTP 非 2xx ⇒ failed 并提示（携带后端错误码）', async () => {
    const { chat, toast } = makeChat({
      [SEND_PATH]: () => errorResponse('THREAD_RUN_ACTIVE', 'busy', 409),
    })
    chat.draft.value = 'hi'

    await chat.send({ content: 'hi', attachments: [] })

    expect(chat.phase.value).toBe('failed')
    expect(chat.error.value?.code).toBe('THREAD_RUN_ACTIVE')
    expect(toast.items.value[0]?.text).toBe('该会话已有进行中的回复')
  })

  it('未选择会话时不发请求并提示', async () => {
    const { chat, router, activeThreadId, toast } = makeChat({})
    activeThreadId.value = null
    chat.draft.value = 'hi'

    await chat.send({ content: 'hi', attachments: [] })

    expect(router.calls).toHaveLength(0)
    expect(toast.items.value[0]?.text).toBe('请先选择数字人')
  })

  it('进行中重复 send 被忽略（FR-006）', async () => {
    const { stream, push, close } = openStream()
    const { chat, router } = makeChat({ [SEND_PATH]: () => new Response(stream) })
    chat.draft.value = 'hi'

    const first = chat.send({ content: 'hi', attachments: [] })
    await flush()
    await chat.send({ content: 'again', attachments: [] })

    expect(router.calls).toHaveLength(1)

    push(sseFrame('done', DONE_COMPLETED))
    close()
    await first
  })

  it('recover 重新拉取结果并回到可发送态（FR-050）', async () => {
    const { chat, finished } = makeChat({})
    chat.draft.value = 'hi'

    await chat.recover()

    expect(finished).toEqual(['t1'])
    expect(chat.phase.value).toBe('completed')
    expect(chat.error.value).toBeNull()
  })

  it('切换会话时重置本轮状态', async () => {
    const { chat, activeThreadId } = makeChat({
      [SEND_PATH]: () => sseResponse([sseFrame('done', DONE_COMPLETED)]),
    })
    chat.draft.value = 'hi'
    await chat.send({ content: 'hi', attachments: [] })
    expect(chat.phase.value).toBe('completed')

    activeThreadId.value = 't2'
    await flush()

    expect(chat.phase.value).toBe('idle')
    expect(chat.streamingText.value).toBe('')
  })
})

describe('useChatStream - 请求体构造（contracts §4.1）', () => {
  it('提交 content / thinking / model 与结构化 attachments', async () => {
    const { chat, router } = makeChat({
      [SEND_PATH]: () => sseResponse([sseFrame('done', DONE_COMPLETED)]),
    })
    chat.draft.value = 'x'
    chat.setThinking(true)

    await chat.send({
      content: '请分析',
      attachments: [{ dir: '生产计划', filename: '计划_1.csv' }],
    })

    expect(router.bodiesOf('POST', '/api/threads/t1/messages')).toEqual([
      {
        content: '请分析',
        thinking: true,
        model: 'qwen-max',
        attachments: [{ dir: '生产计划', filename: '计划_1.csv' }],
      },
    ])
  })

  it('未选择模型时不提交 model 字段（后端用默认模型）', async () => {
    const { chat, router } = makeChat(
      { [SEND_PATH]: () => sseResponse([sseFrame('done', DONE_COMPLETED)]) },
      { model: null },
    )
    chat.draft.value = 'x'

    await chat.send({ content: 'hi', attachments: [] })

    const body = router.bodiesOf('POST', '/api/threads/t1/messages')[0] as Record<string, unknown>
    expect('model' in body).toBe(false)
  })

  it('无引用时不提交 attachments 字段', async () => {
    const { chat, router } = makeChat({
      [SEND_PATH]: () => sseResponse([sseFrame('done', DONE_COMPLETED)]),
    })
    chat.draft.value = 'x'

    await chat.send({ content: 'hi', attachments: [] })

    const body = router.bodiesOf('POST', '/api/threads/t1/messages')[0] as Record<string, unknown>
    expect('attachments' in body).toBe(false)
    expect(body.thinking).toBe(false)
  })
})

describe('useChatStream - 中断（FR-007）', () => {
  it('stop 通知后端中断、进入 aborted 并停止渲染', async () => {
    const { stream, push } = openStream()
    const { chat, stopped } = makeChat({ [SEND_PATH]: () => new Response(stream) })
    chat.draft.value = 'hi'

    const task = chat.send({ content: 'hi', attachments: [] })
    await flush()
    push(sseFrame('content', { delta: '部分' }))
    await flush()

    await chat.stop()

    expect(stopped).toEqual(['t1'])
    expect(chat.phase.value).toBe('aborted')
    // 中断不视为失败，不弹错误提示
    expect(chat.error.value).toBeNull()

    await task
  })

  it('非进行中调用 stop 为无操作', async () => {
    const { chat, stopped } = makeChat({})

    await chat.stop()

    expect(stopped).toEqual([])
  })
})

describe('useChatStream - 思考开关与可发送态', () => {
  it('思考开关默认关闭，并持久化到 sessionStorage', async () => {
    const storage = memoryStorage()
    const { chat } = makeChat({}, { storage })

    expect(chat.thinkingEnabled.value).toBe(false)

    chat.setThinking(true)
    await flush()

    expect(storage.getItem(STORAGE_KEY_THINKING)).toBe('1')
  })

  it('从 sessionStorage 恢复思考开关', () => {
    const storage = memoryStorage({ [STORAGE_KEY_THINKING]: '1' })
    const { chat } = makeChat({}, { storage })

    expect(chat.thinkingEnabled.value).toBe(true)
  })

  it('canSend 需草稿非空且不在进行中（V-06）', async () => {
    const { stream, push, close } = openStream()
    const { chat } = makeChat({ [SEND_PATH]: () => new Response(stream) })

    expect(chat.canSend.value).toBe(false)

    chat.draft.value = 'hi'
    expect(chat.canSend.value).toBe(true)

    chat.draft.value = '   '
    expect(chat.canSend.value).toBe(false)

    chat.draft.value = 'hi'
    const task = chat.send({ content: 'hi', attachments: [] })
    await flush()
    expect(chat.canSend.value).toBe(false)

    push(sseFrame('done', DONE_COMPLETED))
    close()
    await task
    expect(chat.canSend.value).toBe(true)
  })

  it('hasThinking 仅在开启思考且有内容时为真', async () => {
    const { chat } = makeChat({
      [SEND_PATH]: () =>
        sseResponse([
          sseFrame('thinking', { delta: '想' }),
          sseFrame('done', DONE_COMPLETED),
        ]),
    })
    chat.draft.value = 'hi'

    await chat.send({ content: 'hi', attachments: [] })

    expect(chat.hasThinking.value).toBe(false)

    chat.setThinking(true)
    expect(chat.hasThinking.value).toBe(true)
  })

  it('startedAt 记录本地计时起点（注入时钟）', async () => {
    const router = createFetchRouter({
      [SEND_PATH]: () => sseResponse([sseFrame('done', DONE_COMPLETED)]),
    })
    const chat = createChatStreamStore({
      activeThreadId: ref<string | null>('t1'),
      getModel: () => null,
      fetchImpl: router.fetch,
      storage: memoryStorage(),
      now: () => 1_700_000_000_000,
    })
    chat.draft.value = 'x'

    await chat.send({ content: 'hi', attachments: [] })

    expect(chat.startedAt.value).toBe(1_700_000_000_000)
  })

  it('reset 清空本轮全部状态', async () => {
    const { chat } = makeChat({
      [SEND_PATH]: () => sseResponse([sseFrame('done', DONE_COMPLETED)]),
    })
    chat.draft.value = 'x'
    await chat.send({ content: 'hi', attachments: [] })

    chat.reset()

    expect(chat.phase.value).toBe('idle')
    expect(chat.streamingText.value).toBe('')
    expect(chat.streamingThinking.value).toBe('')
    expect(chat.toolCalls.value).toEqual([])
    expect(chat.usage.value).toBeNull()
    expect(chat.durationSeconds.value).toBeNull()
    expect(chat.streamingAgentName.value).toBeNull()
  })
})

describe('useChatStream - 读取中断（FR-050、SC-020）', () => {
  it('流读取抛错 ⇒ failed 且可 recover', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseFrame('content', { delta: 'a' })))
        controller.error(new Error('connection reset'))
      },
    })
    const { chat, finished } = makeChat({ [SEND_PATH]: () => new Response(stream) })
    chat.draft.value = 'hi'

    await chat.send({ content: 'hi', attachments: [] })

    expect(chat.phase.value).toBe('failed')

    await chat.recover()

    expect(finished).toEqual(['t1'])
    expect(chat.phase.value).toBe('completed')
  })

  it('网络异常 ⇒ failed 且提示网络文案', async () => {
    const { chat, toast } = makeChat({})
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const isolated = createChatStreamStore({
      activeThreadId: ref<string | null>('t1'),
      getModel: () => null,
      fetchImpl: fetchMock as unknown as typeof fetch,
      toast,
      storage: memoryStorage(),
    })
    isolated.draft.value = 'x'

    await isolated.send({ content: 'hi', attachments: [] })

    expect(isolated.phase.value).toBe('failed')
    expect(isolated.error.value?.code).toBe('NETWORK_ERROR')
    expect(chat.phase.value).toBe('idle')
  })
})

describe('useChatStream - 消息反馈（FR-027 / V-08）', () => {
  function makeFeedbackChat(
    options: { threadId?: string | null; feedback?: FeedbackValue; fail?: boolean } = {},
  ) {
    const applied: Array<[string, FeedbackValue]> = []
    const sent: Array<[string, string, FeedbackValue]> = []
    const toast = createToastStore()
    let current: FeedbackValue = options.feedback ?? null

    const chat = createChatStreamStore({
      activeThreadId: ref<string | null>(options.threadId === undefined ? 't1' : options.threadId),
      getModel: () => null,
      feedbackOf: () => current,
      applyFeedback: (messageId, value) => {
        current = value
        applied.push([messageId, value])
      },
      sendFeedback: async (threadId, messageId, value) => {
        sent.push([threadId, messageId, value])
        if (options.fail) {
          throw new Error('boom')
        }
      },
      toast,
      storage: memoryStorage(),
    })

    return { chat, applied, sent, toast }
  }

  it('点赞：先本地乐观更新再提交后端', async () => {
    const { chat, applied, sent } = makeFeedbackChat()

    await chat.submitFeedback('m1', 'up')

    expect(applied).toEqual([['m1', 'up']])
    expect(sent).toEqual([['t1', 'm1', 'up']])
  })

  it('同值重复提交 = 取消，提交 null', async () => {
    const { chat, applied, sent } = makeFeedbackChat({ feedback: 'up' })

    await chat.submitFeedback('m1', 'up')

    expect(sent).toEqual([['t1', 'm1', null]])
    expect(applied).toEqual([['m1', null]])
  })

  it('上层已换算的取消值（null）直接透传', async () => {
    const { chat, sent } = makeFeedbackChat({ feedback: 'down' })

    await chat.submitFeedback('m2', null)

    expect(sent).toEqual([['t1', 'm2', null]])
  })

  it('提交失败：回滚为原值并提示', async () => {
    const { chat, applied, toast } = makeFeedbackChat({ feedback: null, fail: true })

    await chat.submitFeedback('m1', 'down')

    // 先乐观置 down，失败后回滚为 null
    expect(applied).toEqual([
      ['m1', 'down'],
      ['m1', null],
    ])
    const items = toast.items.value
    expect(items[items.length - 1]?.text).toBe('网络异常，请检查连接后重试')
  })

  it('无当前会话或空 message_id 时不提交', async () => {
    const withoutThread = makeFeedbackChat({ threadId: null })
    await withoutThread.chat.submitFeedback('m1', 'up')
    expect(withoutThread.sent).toEqual([])

    const withThread = makeFeedbackChat()
    await withThread.chat.submitFeedback('', 'up')
    expect(withThread.sent).toEqual([])
  })
})
