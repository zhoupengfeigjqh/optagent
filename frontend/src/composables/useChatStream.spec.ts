import { nextTick, ref } from 'vue'
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

function sseFetch(script: string): typeof fetch {
  return (async () =>
    new Response(script, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })) as unknown as typeof fetch
}

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

  it('显式技能：请求体带 skill，乐观气泡也带（刷新前即可见）', async () => {
    let body: Record<string, unknown> = {}
    const inner = sseFetch(DONE_SCRIPT)
    const fetchImpl = ((url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return inner(url, init)
    }) as unknown as typeof fetch
    const store = createChatStreamStore(makeDeps({ fetchImpl }))

    const pending = store.send({
      content: '查一下 S-1024 的账期',
      attachments: [],
      skill: 'supplier-query',
    })
    await flush()

    expect(body.skill).toBe('supplier-query')
    expect(store.pendingUserMessage.value?.skill).toBe('supplier-query')
    await pending
  })

  it('术语替换后：气泡显示的就是实际提交的替换文本（2026-11-07 展示与提交同源）', async () => {
    const store = createChatStreamStore(makeDeps({ fetchImpl: PENDING_FETCH }))

    const pending = store.send({
      content: '看下供应商或供应商编号的库存',
      attachments: [],
    })
    await flush()

    // 用户点了"使用替换后"，聊天区必须看到替换结果，而不是他最初的原话
    expect(store.pendingUserMessage.value?.content).toBe('看下供应商或供应商编号的库存')

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

    expect(store.pendingUserMessage.value).toBeNull()
    expect(store.phase.value).toBe(RUN_PHASE.IDLE)
  })
})

describe('useChatStream —— done 直推卡片（007 修订 · Tail Protocol）', () => {
  const SCRIPT_WITH_CARD = [
    'event: content',
    'data: {"delta":"你好"}',
    '',
    'event: done',
    'data: {"finish_reason":"completed","usage":{"input_tokens":1,"output_tokens":2},"duration_seconds":1.2,"message_id":"m_1","agent_name":"demo","next_actions":{"message_id":"m_1","actions":[{"prompt":"整理表格","tool_tips":[{"name":"QueryPurchaseRecords","title":"查询采购订单信息","ontology_id":"1","ontology_name":"采购管理"}]}]}}',
    '',
    '',
  ].join('\n')

  it('done 带 next_actions → 经 applyNextActions 写入（即刻可见，无轮询）', async () => {
    const applyNextActions = vi.fn()
    const store = createChatStreamStore(
      makeDeps({ fetchImpl: sseFetch(SCRIPT_WITH_CARD), applyNextActions }),
    )

    await store.send({ content: '你好', attachments: [] })

    expect(applyNextActions).toHaveBeenCalledTimes(1)
    expect(applyNextActions).toHaveBeenCalledWith({
      message_id: 'm_1',
      actions: [
        {
          prompt: '整理表格',
          tool_tips: [
            {
              name: 'QueryPurchaseRecords',
              title: '查询采购订单信息',
              ontology_id: '1',
              ontology_name: '采购管理',
            },
          ],
        },
      ],
    })
  })

  it('done 不带 next_actions → 不调用 applyNextActions（不动现态）', async () => {
    const applyNextActions = vi.fn()
    const store = createChatStreamStore(makeDeps({ applyNextActions }))

    await store.send({ content: '你好', attachments: [] })

    expect(applyNextActions).not.toHaveBeenCalled()
  })
})

/**
 * 按会话分桶的草稿（2026-10-16）。
 *
 * 回归的 bug：草稿是**全局单例**——在 A 里打了一半、切到 B，那半句跟到了 B（串台）；
 * 在 B 发送时又被清掉（丢失）。这里钉三件事：存旧取新、视图态新对话不产生幽灵草稿、
 * 桶数有上限。
 */
describe('useChatStream —— 按会话分桶的草稿（2026-10-16）', () => {
  it('切走再切回：A 里打了一半的草稿原样还在，且不会串到 B', async () => {
    const activeThreadId = ref<string | null>('th_a')
    const store = createChatStreamStore(makeDeps({ activeThreadId }))

    store.draft.value = '把上个月的生产计划'
    activeThreadId.value = 'th_b'
    await nextTick()

    expect(store.draft.value).toBe('')

    store.draft.value = 'B 的问题'
    activeThreadId.value = 'th_a'
    await nextTick()

    expect(store.draft.value).toBe('把上个月的生产计划')
  })

  it('视图态新对话（id 为 null）：不留幽灵草稿', async () => {
    const activeThreadId = ref<string | null>(null)
    const store = createChatStreamStore(makeDeps({ activeThreadId }))

    store.draft.value = '第一句'
    activeThreadId.value = 'th_created'
    await nextTick()
    expect(store.draft.value).toBe('')

    // 再点「新建会话」回到视图态：不能把刚才那句当成"新对话的草稿"吐出来
    activeThreadId.value = null
    await nextTick()
    expect(store.draft.value).toBe('')
  })

  it('切换会话同时重置本轮瞬态：草稿换了，流式残留也必须清掉（三件事同一时刻）', async () => {
    const activeThreadId = ref<string | null>('th_a')
    const store = createChatStreamStore(makeDeps({ activeThreadId, fetchImpl: PENDING_FETCH }))

    const pending = store.send({ content: '你好', attachments: [] })
    await flush()
    expect(store.pendingUserMessage.value).not.toBeNull()

    store.draft.value = 'A 的草稿'
    activeThreadId.value = 'th_b'
    await nextTick()

    expect(store.pendingUserMessage.value).toBeNull()
    expect(store.draft.value).toBe('')
    await pending
  })

  it('桶上限 50：超限先淘汰最久没碰过的那个，不无限增长', async () => {
    const activeThreadId = ref<string | null>('th_0')
    const store = createChatStreamStore(makeDeps({ activeThreadId }))

    for (let index = 0; index < 51; index += 1) {
      store.draft.value = `草稿 ${index}`
      activeThreadId.value = `th_${index + 1}`
      await nextTick()
    }

    activeThreadId.value = 'th_0'
    await nextTick()
    expect(store.draft.value).toBe('')

    activeThreadId.value = 'th_50'
    await nextTick()
    expect(store.draft.value).toBe('草稿 50')
  })
})

describe('useChatStream —— 跨轮隔离（2026-10-27）', () => {
  it('reset() 之后迟到的旧流不得改写新一轮状态', async () => {
    let releaseFirst!: (response: Response) => void
    let calls = 0
    const fetchImpl = (() => {
      calls += 1
      if (calls === 1) {
        return new Promise<Response>((resolve) => {
          releaseFirst = resolve
        })
      }
      return Promise.resolve(
        new Response(DONE_SCRIPT, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )
    }) as unknown as typeof fetch

    const store = createChatStreamStore(makeDeps({ fetchImpl }))
    const first = store.send({ content: '第一句', attachments: [] })
    const settled = first.catch(() => undefined)
    await flush()
    expect(store.phase.value).toBe(RUN_PHASE.STREAMING)

    store.reset()
    await flush()
    expect(store.phase.value).toBe(RUN_PHASE.IDLE)

    await store.send({ content: '第二句', attachments: [] })
    await flush()
    expect(store.phase.value).toBe(RUN_PHASE.COMPLETED)

    releaseFirst(
      new Response(
        'event: error\ndata: {"error":{"code":"LLM_ERROR","message":"旧轮已失效"}}\n\n',
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        },
      ),
    )
    await settled
    await flush()

    expect(store.phase.value).toBe(RUN_PHASE.COMPLETED)
    expect(store.error.value).toBeNull()
  })
})
