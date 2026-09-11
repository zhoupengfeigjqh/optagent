/**
 * US1 集成验收：首轮对话闭环（S1~S4）
 *
 * 与单元测试的分工：这里不向组件注入桩件，而是**经 DOM 操作 + 真实 composable 链路**驱动
 * （`ChatPanel` → `useChatStream` / `useThreads` / `useAgents`），只把网络层换成
 * `createFetchRouter`，从而覆盖"点击发送 → 建会话 → SSE 事件 → 落盘刷新"的完整编排。
 */

import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { Message } from '../../src/api/types'
import ChatPanel from '../../src/components/chat/ChatPanel.vue'
import { RUN_PHASE } from '../../src/constants/events'
import {
  createFetchRouter,
  errorResponse,
  flush,
  jsonResponse,
  makeFile,
  memoryStorage,
  mountInSession,
  sseFrame,
  waitFor,
  type FetchRouter,
  type RouteHandler,
} from '../helpers'

/* ---------- 桩数据 ---------- */

const AGENT = {
  agent_name: 'ops',
  description: '排产数字人',
  soul: '',
  skills: [],
  enabled_tools: [],
  mcp_servers: [],
}

function conversation(): Record<string, unknown> {
  return {
    thread_id: 't1',
    agent_name: 'ops',
    title: '你好',
    created_at: '2026-09-10T08:00:00.000Z',
    updated_at: '2026-09-10T08:00:02.000Z',
  }
}

function userMessage(content: string): Message {
  return { id: 'u1', role: 'user', content, ts: '2026-09-10T08:00:01.000Z', feedback: null }
}

function assistantMessage(content: string): Message {
  return {
    id: 'a1',
    role: 'assistant',
    content,
    ts: '2026-09-10T08:00:02.000Z',
    status: 'completed',
    usage: { input_tokens: 3, output_tokens: 5 },
    duration_seconds: 1.24,
    feedback: null,
  }
}

function detail(messages: Message[], running = false): Record<string, unknown> {
  return {
    thread_id: 't1',
    agent_name: 'ops',
    title: '你好',
    created_at: '2026-09-10T08:00:00.000Z',
    updated_at: '2026-09-10T08:00:02.000Z',
    total: messages.length,
    messages,
    running,
  }
}

/* ---------- 测试支架 ---------- */

/** 可控 SSE 流：用于断言"两个事件之间"的中间态。 */
function openStream(): {
  stream: ReadableStream<Uint8Array>
  push: (text: string) => void
  close: () => void
} {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(inner) {
      controller = inner
    },
  })
  return {
    stream,
    push: (text) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  }
}

function sseOut(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
}

/** 构造 `FileList`（jsdom 不提供可直接 new 的实现）。 */
function makeFileList(files: File[]): FileList {
  return {
    ...files,
    length: files.length,
    item: (index: number) => files[index] ?? null,
  } as unknown as FileList
}

function createRouter(options: {
  stream: ReadableStream<Uint8Array>
  messages: Message[]
  extraRoutes?: Record<string, RouteHandler>
}): FetchRouter {
  return createFetchRouter({
    'GET /api/agents/current': () => jsonResponse({ agent_name: 'ops' }),
    // `loadCurrent()` = current + detail + current/mcp 三步
    'GET /api/agents/ops': () => jsonResponse(AGENT),
    'GET /api/agents/current/mcp': () => jsonResponse({ mcp_servers: [] }),
    // 工具栏挂载时拉取模型清单（US3）；后端以 `{ models: [...] }` 包装
    'GET /api/models': () =>
      jsonResponse({
        models: [
          { model: 'qwen-max', is_default: true },
          { model: 'qwen-plus', is_default: false },
        ],
      }),
    'POST /api/threads': () => jsonResponse({ thread_id: 't1', title: null }, 201),
    'GET /api/threads': () => jsonResponse([conversation()]),
    'GET /api/threads/t1': () => jsonResponse(detail(options.messages)),
    'POST /api/threads/t1/messages': () => sseOut(options.stream),
    ...options.extraRoutes,
  })
}

type Session = ReturnType<typeof mountInSession>['session']

/** 选中数字人 → 输入 → 点击发送 → 等待流式请求发出。 */
async function startFirstTurn(
  wrapper: VueWrapper,
  session: Session,
  router: FetchRouter,
  content: string,
): Promise<void> {
  await session.agents.loadCurrent()
  await wrapper.find('.composer__input').setValue(content)
  await wrapper.find('.base-button--primary').trigger('click')
  await waitFor(
    () => router.countOf('POST', '/api/threads/t1/messages') === 1,
    '未发起流式请求',
  )
}

function mountChat(router: FetchRouter): { wrapper: VueWrapper; session: Session } {
  return mountInSession(ChatPanel, {
    props: { expanded: false },
    // 内存存储：避免用例之间经真实 sessionStorage 互相污染（思考开关 / 当前模型）
    sessionOptions: { fetchImpl: router.fetch, storage: memoryStorage() },
  })
}

/* ---------- 场景 ---------- */

describe('US1 集成：首轮对话闭环', () => {
  it('S1：居中入口 → 按需建会话 → 流式正文 → 落盘刷新', async () => {
    const { stream, push, close } = openStream()
    const router = createRouter({
      stream,
      messages: [userMessage('你好'), assistantMessage('你好，世界')],
      extraRoutes: {
        'PUT /api/threads/t1/messages/a1/feedback': () =>
          jsonResponse({ message_id: 'a1', feedback: 'up' }),
      },
    })
    const { wrapper, session } = mountChat(router)

    await session.agents.loadCurrent()
    expect(wrapper.find('.chat-panel__hero').exists()).toBe(true)
    expect(wrapper.find('.message-list').exists()).toBe(false)

    await wrapper.find('.composer__input').setValue('  你好  ')
    await wrapper.find('.base-button--primary').trigger('click')
    await waitFor(
      () => router.countOf('POST', '/api/threads/t1/messages') === 1,
      '未发起流式请求',
    )

    // 会话按需创建；正文去首尾空白；无引用时不提交 attachments 字段
    expect(router.countOf('POST', '/api/threads')).toBe(1)
    expect(router.bodiesOf('POST', '/api/threads')).toEqual([{ agent_name: 'ops' }])
    const body = router.bodiesOf('POST', '/api/threads/t1/messages')[0] as Record<string, unknown>
    expect(body.content).toBe('你好')
    expect(body.attachments).toBeUndefined()

    // 流式中：入口下移（FR-004）、展示"思考中"（FR-020）
    expect(wrapper.find('.chat-panel__hero').exists()).toBe(false)
    expect(wrapper.find('.typing-indicator').exists()).toBe(true)
    // V-06：进行中不可再次发送，改为中断入口
    expect(wrapper.find('.base-button--secondary').text()).toBe('中断本轮')

    push(sseFrame('content', { delta: '你好' }))
    await flush()
    expect(wrapper.find('.typing-indicator').exists()).toBe(false)
    expect(wrapper.find('.message-bubble').text()).toContain('你好')

    push(sseFrame('content', { delta: '，世界' }))
    push(
      sseFrame('done', {
        finish_reason: 'completed',
        usage: { input_tokens: 3, output_tokens: 5 },
        duration_seconds: 1.24,
        message_id: 'a1',
      }),
    )
    close()

    await waitFor(() => session.threads.messages.value.length === 2, '消息未落盘')
    expect(wrapper.findAll('.message-bubble')).toHaveLength(2)
    expect(wrapper.find('.message-bubble--completed').exists()).toBe(true)
    expect(wrapper.find('.typing-indicator').exists()).toBe(false)

    // 落盘后即可点赞：乐观更新 + PUT（FR-027 / V-08）
    await wrapper.find('.message-actions__up').trigger('click')
    await waitFor(
      () => router.countOf('PUT', '/api/threads/t1/messages/a1/feedback') === 1,
      '未提交反馈',
    )
    expect(router.bodiesOf('PUT', '/api/threads/t1/messages/a1/feedback')).toEqual([{ value: 'up' }])
    expect(wrapper.find('.message-actions__up').attributes('aria-pressed')).toBe('true')
  })

  it('S2：思考内容仅本轮展示，不进入历史与请求体（V-04）', async () => {
    const { stream, push, close } = openStream()
    const router = createRouter({
      stream,
      messages: [userMessage('帮我排产'), assistantMessage('排产完成')],
    })
    const { wrapper, session } = mountChat(router)

    await session.agents.loadCurrent()
    session.chat.thinkingEnabled.value = true

    await wrapper.find('.composer__input').setValue('帮我排产')
    await wrapper.find('.base-button--primary').trigger('click')
    await waitFor(
      () => router.countOf('POST', '/api/threads/t1/messages') === 1,
      '未发起流式请求',
    )

    const body = router.bodiesOf('POST', '/api/threads/t1/messages')[0] as Record<string, unknown>
    expect(body.thinking).toBe(true)

    push(sseFrame('thinking', { delta: '先分析约束' }))
    push(sseFrame('thinking', { delta: '，再求解' }))
    await flush()

    const block = wrapper.find('.thinking-block')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('先分析约束，再求解')
    // 默认收起
    expect(block.attributes('open')).toBeUndefined()

    push(sseFrame('content', { delta: '排产完成' }))
    push(
      sseFrame('done', {
        finish_reason: 'completed',
        usage: { input_tokens: 4, output_tokens: 6 },
        duration_seconds: 0.8,
        message_id: 'a1',
      }),
    )
    close()

    await waitFor(() => session.threads.messages.value.length === 2, '消息未落盘')

    // 思考内容不落历史（V-04 / FR-023）
    expect(wrapper.find('.thinking-block').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('先分析约束')
    expect(wrapper.text()).toContain('排产完成')
  })

  it('S3：工具徽标随 tool_call 出现、tool_call_end 立即消失（V-05）', async () => {
    const { stream, push, close } = openStream()
    const router = createRouter({
      stream,
      messages: [userMessage('求解'), assistantMessage('求解完成')],
    })
    const { wrapper, session } = mountChat(router)

    await startFirstTurn(wrapper, session, router, '求解')

    // 空数组不渲染任何工具相关 DOM（SC-011）
    expect(wrapper.find('.tool-call-badge').exists()).toBe(false)

    push(sseFrame('tool_call', { call_id: 'c1', name: 'read_file' }))
    await flush()
    const badge = wrapper.find('.tool-call-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.find('.tool-call-badge__name').text()).toBe('read_file')
    expect(badge.find('.tool-call-badge__status').text()).toBe('进行中')
    // 只展示名称与状态，无入参/结果（V-04）
    expect(badge.element.children).toHaveLength(2)

    push(sseFrame('tool_call_end', { call_id: 'c1', status: 'success' }))
    await flush()
    expect(wrapper.find('.tool-call-badge').exists()).toBe(false)

    push(
      sseFrame('done', {
        finish_reason: 'completed',
        usage: { input_tokens: 1, output_tokens: 1 },
        duration_seconds: 0.2,
        message_id: 'a1',
      }),
    )
    close()
    await waitFor(() => session.threads.messages.value.length === 2, '消息未落盘')
  })

  it('S4：中断本轮 → 通知后端、保留已生成内容、不出现操作区', async () => {
    const { stream, push } = openStream()
    const router = createRouter({
      stream,
      messages: [userMessage('你好')],
      extraRoutes: {
        'POST /api/threads/t1/stop': () => jsonResponse({ status: 'stopped' }),
      },
    })
    const { wrapper, session } = mountChat(router)

    await startFirstTurn(wrapper, session, router, '你好')

    push(sseFrame('content', { delta: '半截' }))
    await flush()
    expect(wrapper.find('.message-bubble').text()).toContain('半截')

    await wrapper.find('.base-button--secondary').trigger('click')
    await waitFor(() => router.countOf('POST', '/api/threads/t1/stop') === 1, '未通知后端中断')
    await waitFor(() => session.chat.phase.value === RUN_PHASE.ABORTED, '未进入已中断态')

    // 已生成内容保留展示
    expect(wrapper.find('.message-bubble').text()).toContain('半截')
    // 中断轮不展示操作区与用量（FR-007 / FR-028 / V-07）
    expect(wrapper.find('.message-bubble--completed').exists()).toBe(false)
    expect(wrapper.find('.typing-indicator').exists()).toBe(false)
    expect(wrapper.find('.error-notice').exists()).toBe(false)
  })
})

describe('US3 集成：输入区工具选项', () => {
  it('加号展开 9 个目录；上传失败展示原因并可重试；思考与模型切换生效', async () => {
    const { stream } = openStream()
    const router = createRouter({
      stream,
      messages: [],
      extraRoutes: {
        'POST /api/files/upload': () => errorResponse('FILE_TOO_LARGE', '', 413),
      },
    })
    const { wrapper, session } = mountChat(router)

    // 模型清单加载后展示默认项
    await waitFor(() => session.models.models.value.length > 0, '模型列表未加载')
    expect(wrapper.find('.model-picker__label').text()).toBe('qwen-max（默认）')

    // 加号展开固定的 9 个目录入口（FR-009 / SC-021）
    expect(wrapper.find('.upload-menu').exists()).toBe(false)
    await wrapper.find('.composer-toolbar__left .base-button').trigger('click')
    const dirButtons = wrapper.findAll('.upload-menu__dir-button')
    expect(dirButtons).toHaveLength(9)
    expect(dirButtons[0].text()).toContain('生产计划')

    // 选中文件 → 后端 413 → 失败原因 + 重试（FR-011）
    await dirButtons[0].trigger('click')
    const input = wrapper.find('.upload-menu__input')
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: makeFileList([makeFile('plan.csv', 1024)]),
    })
    await input.trigger('change')
    await waitFor(() => router.countOf('POST', '/api/files/upload') === 1, '未发起上传')
    await waitFor(() => wrapper.find('.upload-item--failed').exists(), '未进入上传失败态')

    const item = wrapper.find('.upload-item')
    expect(item.find('.upload-item__error').text()).toBe('文件超过 50MB')

    await item.find('.upload-item__retry').trigger('click')
    await waitFor(() => router.countOf('POST', '/api/files/upload') === 2, '未重试上传')

    // 思考 / 快速切换（FR-012）
    expect(wrapper.find('.thinking-toggle__label').text()).toBe('快速')
    await wrapper.find('.thinking-toggle').trigger('click')
    expect(session.chat.thinkingEnabled.value).toBe(true)
    expect(wrapper.find('.thinking-toggle__label').text()).toBe('思考')

    // 模型选择并验证当前模型展示（FR-013）
    await wrapper.find('.model-picker .base-dropdown__trigger').trigger('click')
    await wrapper.findAll('.model-picker .base-dropdown__item')[1].trigger('click')
    expect(session.models.current.value).toBe('qwen-plus')
    expect(wrapper.find('.model-picker__label').text()).toBe('qwen-plus')
  })
})
