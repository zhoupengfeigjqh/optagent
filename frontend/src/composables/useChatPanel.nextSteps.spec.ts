/**
 * 单元测试：点击下一步动作卡片的**真实**发送链路（007 · US2）。
 *
 * 本文件用真实 `useChatPanel()`（只把 `useSession` 换成受控的假会话），因此断言的是
 * 端到端行为而不是"处理器被调用过"：
 * - 点卡片只**打开确认**、不发消息（未确认 MUST NOT 发送）；
 * - 确认后**恰好一次** `chat.send`，载荷为 `{content: 提示词, attachments: [], guidance}`；
 * - 连点确认只发一次（进行中即拦截）；
 * - 不可用态（未选数字人 / 会话不可用）明确拒绝且不留残留。
 */
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStarter } from '../api/types'
import { emptyNextSteps } from '../api/next-steps'
import { RUN_PHASE } from '../constants/events'
import { nextStepSendPayload } from '../utils/next-steps'

const h_state = vi.hoisted(() => ({ session: null as unknown }))

// `useChatPanel` 及其依赖的 composable 都经 `useSession()` 取状态：换掉它即可完全掌控输入输出
vi.mock('./useAppSession', () => ({ useSession: () => h_state.session }))

const { useChatPanel } = await import('./useChatPanel')

const ACTION: AgentStarter = {
  prompt: '按交付日期梳理这批订单的风险',
  tools: [{ kind: 'mcp', service: 'erp', name: 'query_order', exposed_name: 'erp__query_order' }],
  guidance: '本轮请优先使用以下工具完成任务：erp__query_order',
}

interface Harness {
  session: Record<string, unknown>
  panel: ReturnType<typeof useChatPanel>
}

/** 受控假会话：只实现 `useChatPanel` 会触碰到的字段 */
function makeSession(options: { agentSelected?: boolean; activeThread?: string | null } = {}) {
  const noop = vi.fn()
  const send = vi.fn(async () => undefined)
  const create = vi.fn(async () => {
    // 模拟"未选数字人 → 创建失败"：activeId 保持为空，聊天区不发生任何事
  })
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
      recover: noop,
      submitFeedback: noop,
      submitInteraction: noop,
      rejectInteraction: noop,
      restoreInteraction: noop,
      setThinking: noop,
      thinkingEnabled: ref(false),
    },
    threads: {
      messages: ref([]),
      activeId: ref<string | null>(
        options.activeThread === undefined ? 'th_1' : options.activeThread,
      ),
      hasMore: ref(false),
      pendingInteraction: ref(null),
      refresh: vi.fn(async () => undefined),
      create,
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
      currentAgent: ref(options.agentSelected === false ? null : { agent_name: 'demo' }),
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
      startMcpSubscription: noop,
      stopMcpSubscription: noop,
    },
    preview: {
      open: ref(false),
      view: ref('list'),
      close: noop,
      openList: noop,
      openFile: noop,
      openLink: noop,
    },
    nextSteps: {
      steps: ref(emptyNextSteps()),
      start: vi.fn(),
      reset: vi.fn(),
    },
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

beforeEach(() => {
  h_state.session = null
})

describe('useChatPanel —— 下一步动作卡片的确认与发送（007）', () => {
  it('点卡片只打开确认；确认后恰好一次发送，载荷与问题实例同款', async () => {
    const { panel, session } = mountHarness(makeSession())
    const send = session.chat as { send: ReturnType<typeof vi.fn> }
    const toast = session.toast as { push: ReturnType<typeof vi.fn> }

    panel.onPickNextStep(ACTION)
    expect(panel.pendingSuggestion.value).toEqual(ACTION)
    expect(send.send).not.toHaveBeenCalled()

    await panel.onConfirmSuggestion()

    expect(send.send).toHaveBeenCalledTimes(1)
    expect(send.send).toHaveBeenCalledWith(nextStepSendPayload(ACTION))
    expect(send.send).toHaveBeenCalledWith({
      content: '按交付日期梳理这批订单的风险',
      attachments: [],
      guidance: '本轮请优先使用以下工具完成任务：erp__query_order',
    })
    expect(panel.pendingSuggestion.value).toBeNull()
    expect(toast.push).not.toHaveBeenCalled()
  })

  it('取消 → 关闭弹窗，不发消息（草稿与卡片都不受影响）', () => {
    const { panel, session } = mountHarness(makeSession())
    const send = session.chat as { send: ReturnType<typeof vi.fn> }

    panel.onPickNextStep(ACTION)
    panel.onCancelSuggestion()

    expect(panel.pendingSuggestion.value).toBeNull()
    expect(send.send).not.toHaveBeenCalled()
  })

  it('发起即清空上一轮卡片：清空发生在发送之前，MUST NOT 等到本轮输出完毕', async () => {
    const { panel, session } = mountHarness(makeSession())
    const chat = session.chat as { send: ReturnType<typeof vi.fn> }
    const nextSteps = session.nextSteps as { reset: ReturnType<typeof vi.fn> }
    // 用调用顺序证明"清空"早于"发送"（回归：旧卡片一直挂到本轮答完才消失）
    const order: string[] = []
    nextSteps.reset.mockImplementation(() => order.push('reset'))
    chat.send.mockImplementation(async () => {
      order.push('send')
    })

    panel.onPickNextStep(ACTION)
    await panel.onConfirmSuggestion()

    expect(order).toEqual(['reset', 'send'])
  })

  it('确认发送后弹窗立即关闭：不等待本轮输出结束（chat.send 挂起也不等）', async () => {
    const { panel, session } = mountHarness(makeSession())
    const chat = session.chat as { send: ReturnType<typeof vi.fn> }
    // `send` 永不 resolve：模拟"本轮仍在输出"。若弹窗要等本轮结束，`pendingSuggestion` 会一直挂住
    chat.send.mockImplementation(() => new Promise<void>(() => {}))

    panel.onPickNextStep(ACTION)
    await panel.onConfirmSuggestion()

    expect(chat.send).toHaveBeenCalledTimes(1)
    // 发出即关（不等本轮答完）——这正是"点确认后弹窗一直挂到输出结束才消失"的回归防线
    expect(panel.pendingSuggestion.value).toBeNull()
  })

  it('连点确认只发一次（进行中即拦截）', async () => {
    const { panel, session } = mountHarness(makeSession())
    const chat = session.chat as { send: ReturnType<typeof vi.fn> }
    chat.send.mockImplementation(() => new Promise<void>(() => {}))

    panel.onPickNextStep(ACTION)
    void panel.onConfirmSuggestion()
    await panel.onConfirmSuggestion() // 第二次：仍在发送中

    expect(chat.send).toHaveBeenCalledTimes(1)
  })

  it('未选数字人 → 明确提示且不打开弹窗、不发送', () => {
    const { panel, session } = mountHarness(makeSession({ agentSelected: false }))
    const toast = session.toast as { push: ReturnType<typeof vi.fn> }

    panel.onPickNextStep(ACTION)

    expect(panel.pendingSuggestion.value).toBeNull()
    expect(toast.push).toHaveBeenCalledWith('error', '请先选择数字人再发送')
  })

  it('本轮进行中 → 不响应（避免在别人的通道上排队发送）', () => {
    const session = makeSession()
    const { panel } = mountHarness(session)
    ;(session.chat as { phase: { value: string } }).phase.value = RUN_PHASE.STREAMING

    panel.onPickNextStep(ACTION)

    expect(panel.pendingSuggestion.value).toBeNull()
  })

  it('会话不可用（已被删除）→ 不发送且保留确认内容（用户可重试或取消）', async () => {
    const session = makeSession({ activeThread: null })
    const { panel } = mountHarness(session)
    const chat = session.chat as { send: ReturnType<typeof vi.fn> }
    const threads = session.threads as { create: ReturnType<typeof vi.fn> }

    panel.onPickNextStep(ACTION)
    await panel.onConfirmSuggestion()

    expect(threads.create).toHaveBeenCalledTimes(1)
    expect(chat.send).not.toHaveBeenCalled()
    expect(panel.pendingSuggestion.value).toEqual(ACTION)
  })
})
