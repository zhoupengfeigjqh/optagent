/**
 * 单元测试：历史失败轮「重试本轮」的**真实**发送链路（2026-10-15 断链修复，`TR-58`）。
 *
 * 背景：`MessageBubble` 的失败提示条一直带"重试"按钮，但它发出的 `retry` 事件在
 * `MessageList` / `ChatPanel` 两级都没有接收方——点下去什么都不发生。修复后，
 * 列表层从历史里解析出"该轮的用户消息"并上抛，装配层用**唯一发送链路**重发。
 *
 * 本文件用真实 `useChatPanel()`（只把 `useSession` 换成受控的假会话），因此断言的是
 * 端到端行为而不是"处理器被调用过"：
 * - 一次点击 = 恰好一次 `chat.send`，载荷就是该轮的用户消息（正文 + 引用）；
 * - 本轮进行中不响应——且**不清草稿**（否则用户正在输入的内容会被凭空丢掉）。
 *
 * 上游两级（气泡 → 列表 → 面板绑定）由 `MessageList.spec.ts` / `ChatPanel.spec.ts` 覆盖。
 */
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { emptyNextSteps } from '../api/next-steps'
import type { FileReference } from '../api/types'
import { RUN_PHASE } from '../constants/events'

const h_state = vi.hoisted(() => ({ session: null as unknown }))

// `useChatPanel` 及其依赖的 composable 都经 `useSession()` 取状态：换掉它即可完全掌控输入输出
vi.mock('./useAppSession', () => ({ useSession: () => h_state.session }))

const { useChatPanel } = await import('./useChatPanel')

/** 失败轮里那条用户消息的引用（重发时原样提交） */
const ATTACHMENT: FileReference = { dir: '数据准备/生产计划', filename: 'plan.csv' }

interface Harness {
  session: Record<string, unknown>
  panel: ReturnType<typeof useChatPanel>
}

/** 受控假会话：只实现 `useChatPanel` 会触碰到的字段 */
function makeSession() {
  const noop = vi.fn()
  const send = vi.fn(async () => undefined)
  // 断言的处理器各自独立：`noop` 是**同一个** spy 实例（onMounted 也会调到它），
  // 共用一个会让 `recover` 凭空多出调用次数
  const recover = vi.fn()
  return {
    chat: {
      draft: ref(''),
      phase: ref<string>(RUN_PHASE.IDLE),
      streamingText: ref(''),
      streamingThinking: ref(''),
      streamingAgentName: ref(null),
      toolCalls: ref([]),
      error: ref(null),
      lastRetryableTurn: ref(null),
      pendingInteraction: ref(null),
      send,
      stop: noop,
      recover,
      submitFeedback: noop,
      submitInteraction: noop,
      rejectInteraction: noop,
      restoreInteraction: noop,
      setThinking: noop,
      thinkingEnabled: ref(false),
    },
    threads: {
      messages: ref([]),
      activeId: ref<string | null>('th_1'),
      hasMore: ref(false),
      pendingInteraction: ref(null),
      refresh: vi.fn(async () => undefined),
      create: vi.fn(async () => undefined),
      loadMore: noop,
      toolCallResult: noop,
    },
    search: {
      isOpen: ref(false),
      keyword: ref(''),
      total: ref(0),
      activeIndex: ref(0),
      next: noop,
      close: noop,
      open: noop,
    },
    models: {
      current: ref(null),
      models: ref([]),
      load: vi.fn(async () => undefined),
      select: noop,
    },
    uploads: { items: ref([]), upload: noop, retry: noop },
    mention: {
      references: ref([]),
      open: ref(false),
      spaces: ref([]),
      column: ref('space'),
      activeSpace: ref(null),
      activeDir: ref(null),
      dirs: ref([]),
      files: ref([]),
      activeIndex: ref(0),
      close: noop,
      move: noop,
      back: noop,
      reset: noop,
      remove: noop,
      buildAttachments: () => [],
      handleInput: noop,
      pickSpace: noop,
      pickDir: noop,
      pickFile: noop,
      confirmActive: () => null,
    },
    workspace: {
      spaces: ref([]),
      loading: ref(false),
      exists: () => true,
      load: vi.fn(async () => undefined),
      uploadExtensionsOf: () => [],
    },
    agents: {
      currentAgent: ref({ agent_name: 'demo' }),
      candidates: ref([]),
      mcpServers: ref([]),
      // 2026-10-18：发送前 MCP 就绪门读这两个字段；无灰 → 零等待
      mcpPending: ref(false),
      ensureMcpReady: vi.fn(async () => true),
      warmMcp: vi.fn(async () => undefined),
      switchingDisabled: ref(false),
      switching: ref(false),
      loadCurrent: vi.fn(async () => undefined),
      loadCandidates: vi.fn(async () => undefined),
      switchTo: vi.fn(async () => undefined),
      startMcpSubscription: vi.fn(),
      stopMcpSubscription: vi.fn(),
    },
    preview: {
      open: ref(false),
      view: ref('list'),
      close: noop,
      openList: noop,
      openFile: noop,
      openLink: noop,
    },
    nextSteps: { steps: ref(emptyNextSteps()), start: vi.fn(), reset: vi.fn() },
    produced: { unreadCount: ref(0) },
    toast: { push: vi.fn() },
    files: {},
    now: () => 0,
    initialThreadId: null,
    rememberActiveThread: noop,
  }
}

/** 承载 `useChatPanel()` 的最小组件（组合式函数必须在 `setup()` 内调用） */
function mountHarness(session: Record<string, unknown>): Harness {
  h_state.session = session
  let panel: ReturnType<typeof useChatPanel> | null = null
  const Harness = defineComponent({
    setup() {
      panel = useChatPanel()
      return () => h('div')
    },
  })
  mount(Harness)
  return { session, panel: panel! }
}

/** 让 `onSend` 的异步链路跑完（`chat.send` 之前若有 await，仍能被断言到） */
const flush = (): Promise<void> => Promise.resolve().then(() => Promise.resolve())

beforeEach(() => {
  h_state.session = null
})

describe('useChatPanel —— 历史失败轮「重试本轮」（TR-58）', () => {
  it('一次点击 = 恰好一次 chat.send，载荷是**该轮的用户消息**（正文 + 引用）', async () => {
    const { panel, session } = mountHarness(makeSession())
    const chat = session.chat as { send: ReturnType<typeof vi.fn> }

    panel.onRetryTurn({ content: '帮我看看这份计划', attachments: [ATTACHMENT] })
    await flush()

    expect(chat.send).toHaveBeenCalledTimes(1)
    expect(chat.send).toHaveBeenCalledWith({
      content: '帮我看看这份计划',
      attachments: [ATTACHMENT],
    })
  })

  it('本轮进行中不响应：既不发，也不清掉用户正在输入的草稿', async () => {
    const session = makeSession()
    const { panel } = mountHarness(session)
    const chat = session.chat as { send: ReturnType<typeof vi.fn>; draft: { value: string } }
    chat.draft.value = '我正在输入的内容'
    ;(session.chat as { phase: { value: string } }).phase.value = RUN_PHASE.STREAMING

    panel.onRetryTurn({ content: '旧内容', attachments: [] })
    await flush()

    expect(chat.send).not.toHaveBeenCalled()
    // 关键：`onSend` 会先清草稿再被 `chat.send` 的并发校验挡下，故这里必须在更早处拦掉
    expect(chat.draft.value).toBe('我正在输入的内容')
  })
})

/**
 * 面板级失败块的分流判据（TR-58）：本轮用户消息还在缓存里 →「重试本轮」真正重发；
 * 缓存不可用（断连：后端那一轮可能仍在跑）→ 保持「重新获取」重拉历史。
 */
describe('useChatPanel —— 失败块「重试本轮」的可用性（TR-58）', () => {
  interface ChatState {
    phase: { value: string }
    lastRetryableTurn: { value: { content: string; attachments: FileReference[] } | null }
    send: ReturnType<typeof vi.fn>
  }

  it('失败轮 + 缓存可用：canRegenerate 为真，`onRegenerate()` 复用 onSend 全链路重发该轮', async () => {
    const session = makeSession()
    const { panel } = mountHarness(session)
    const chat = session.chat as unknown as ChatState
    chat.phase.value = RUN_PHASE.FAILED
    chat.lastRetryableTurn.value = { content: '帮我看看这份计划', attachments: [ATTACHMENT] }

    expect(panel.streaming.value?.canRegenerate).toBe(true)

    await panel.onRegenerate()
    await flush()

    expect(chat.send).toHaveBeenCalledTimes(1)
    expect(chat.send).toHaveBeenCalledWith({
      content: '帮我看看这份计划',
      attachments: [ATTACHMENT],
    })
  })

  it('断连型失败（缓存未置位）：canRegenerate 为假 → 按钮落回「重新获取」', () => {
    const session = makeSession()
    const { panel } = mountHarness(session)
    const chat = session.chat as unknown as ChatState
    chat.phase.value = RUN_PHASE.FAILED
    chat.lastRetryableTurn.value = null

    expect(panel.isFailed.value).toBe(true)
    expect(panel.streaming.value?.canRegenerate).toBe(false)
  })

  it('面板级入口：本轮可重发 → 真正重发（一次 chat.send）', async () => {
    const session = makeSession()
    const { panel } = mountHarness(session)
    const chat = session.chat as unknown as ChatState
    chat.phase.value = RUN_PHASE.FAILED
    chat.lastRetryableTurn.value = { content: '帮我看看这份计划', attachments: [ATTACHMENT] }

    panel.onRetryFailedRun()
    await flush()

    expect(chat.send).toHaveBeenCalledTimes(1)
    expect(chat.send).toHaveBeenCalledWith({
      content: '帮我看看这份计划',
      attachments: [ATTACHMENT],
    })
    expect((session.chat as { recover: ReturnType<typeof vi.fn> }).recover).not.toHaveBeenCalled()
  })

  it('面板级入口：本轮不可重发（断连）→ 不重发，走 recover 重拉历史', async () => {
    const session = makeSession()
    const { panel } = mountHarness(session)
    const chat = session.chat as unknown as ChatState
    chat.phase.value = RUN_PHASE.FAILED
    chat.lastRetryableTurn.value = null

    panel.onRetryFailedRun()
    await flush()

    expect(chat.send).not.toHaveBeenCalled()
    expect((session.chat as { recover: ReturnType<typeof vi.fn> }).recover).toHaveBeenCalledTimes(1)
  })
})

/**
 * 发送前的 MCP 就绪门（2026-10-18）：灰 → 有连接结果 → 才提交。
 *
 * 断言的是**顺序**与**次数**，不是"函数被调用过"：
 * ① 有灰时必须先等（`ensureMcpReady` 先于 `chat.send`）；
 * ② 无灰时零等待（稳态不能凭空多出延迟）；
 * ③ 等待期间重复点击只发一次（否则会排队发两轮）。
 */
describe('useChatPanel —— 发送前 MCP 就绪门（2026-10-18）', () => {
  interface GateAgents {
    mcpPending: { value: boolean }
    ensureMcpReady: ReturnType<typeof vi.fn>
  }

  it('仍有灰：先等出连接结果，再提交', async () => {
    const session = makeSession()
    const agents = session.agents as unknown as GateAgents
    const chat = session.chat as unknown as { send: ReturnType<typeof vi.fn> }
    const order: string[] = []
    agents.mcpPending.value = true
    agents.ensureMcpReady.mockImplementation(async () => {
      order.push('wait')
      return true
    })
    chat.send.mockImplementation(async () => {
      order.push('send')
    })
    const { panel } = mountHarness(session)

    await panel.onSend({ content: '帮我看看产能', attachments: [] })

    expect(order).toEqual(['wait', 'send'])
  })

  it('无灰（已全部有结果 / 未配 MCP）：零等待直接提交', async () => {
    const session = makeSession()
    const agents = session.agents as unknown as GateAgents
    const chat = session.chat as unknown as { send: ReturnType<typeof vi.fn> }
    const { panel } = mountHarness(session)

    await panel.onSend({ content: '帮我看看产能', attachments: [] })

    expect(agents.ensureMcpReady).not.toHaveBeenCalled()
    expect(chat.send).toHaveBeenCalledTimes(1)
  })

  it('等待期间重复点击：只提交一次', async () => {
    const session = makeSession()
    const agents = session.agents as unknown as GateAgents
    const chat = session.chat as unknown as { send: ReturnType<typeof vi.fn> }
    agents.mcpPending.value = true
    let settle: ((ready: boolean) => void) | undefined
    agents.ensureMcpReady.mockReturnValue(
      new Promise<boolean>((resolve) => {
        settle = resolve
      }),
    )
    const { panel } = mountHarness(session)

    const first = panel.onSend({ content: '帮我看看产能', attachments: [] })
    await flush()
    const second = await panel.onSend({ content: '帮我看看产能', attachments: [] })
    settle?.(true)
    await first

    expect(second).toBe(false)
    expect(chat.send).toHaveBeenCalledTimes(1)
  })

  it('等到超时：仍然提交，并给出可感知提示（不因 MCP 挂掉而阻断聊天）', async () => {
    const session = makeSession()
    const agents = session.agents as unknown as GateAgents
    const chat = session.chat as unknown as { send: ReturnType<typeof vi.fn> }
    const toast = session.toast as { push: ReturnType<typeof vi.fn> }
    agents.mcpPending.value = true
    agents.ensureMcpReady.mockResolvedValue(false)
    const { panel } = mountHarness(session)

    await panel.onSend({ content: '帮我看看产能', attachments: [] })

    expect(chat.send).toHaveBeenCalledTimes(1)
    expect(toast.push).toHaveBeenCalledWith('info', 'MCP 服务连接超时，本轮可能缺少相关工具')
  })
})
