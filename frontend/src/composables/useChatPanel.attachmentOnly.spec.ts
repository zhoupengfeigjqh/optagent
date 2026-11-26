import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_MESSAGE_CHARS } from '../api/messages'
import { emptyNextSteps } from '../api/next-steps'
import type { FileReference } from '../api/types'
import { RUN_PHASE } from '../constants/events'

const h_state = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('./useAppSession', () => ({ useSession: () => h_state.session }))

const { useChatPanel } = await import('./useChatPanel')

const PLAN: FileReference = { dir: '数据准备/生产计划', filename: 'plan.csv' }
const ORDER: FileReference = { dir: '临时空间', filename: 'order.xlsx' }

function makeSession() {
  const noop = vi.fn()
  const send = vi.fn(async () => undefined)
  return {
    chat: {
      draft: ref(''),
      phase: ref<string>(RUN_PHASE.IDLE),
      streamingText: ref(''),
      streamingThinking: ref(''),
      streamingAgentName: ref(null),
      toolCalls: ref([]),
      stalled: ref(false),
      segments: ref([]),
      error: ref(null),
      lastRetryableTurn: ref(null),
      pendingInteraction: ref(null),
      send,
      stop: noop,
      recover: vi.fn(),
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
    skillMention: { selected: ref<string | null>(null), open: ref(false), sync: vi.fn(), reset: vi.fn() },
    produced: { unreadCount: ref(0) },
    toast: { push: vi.fn() },
    termNormalize: { review: vi.fn(async () => ({ items: [] })) },
    files: {},
    now: () => 0,
    initialThreadId: null,
    rememberActiveThread: noop,
  }
}

function mountHarness(session: Record<string, unknown>) {
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

interface ChatSpy {
  send: ReturnType<typeof vi.fn>
}
interface TermSpy {
  review: ReturnType<typeof vi.fn>
}
interface ToastSpy {
  push: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  h_state.session = null
})

describe('useChatPanel —— 只有附件也能发送（026）', () => {
  it('正文只有空白 + 1 个附件 → 合成「请查看这个文件」，且不弹术语替换', async () => {
    const { panel, session } = mountHarness(makeSession())
    const chat = session.chat as unknown as ChatSpy
    const term = session.termNormalize as unknown as TermSpy

    const ok = await panel.onSend({ content: '   ', attachments: [PLAN] })

    expect(ok).toBe(true)
    expect(chat.send).toHaveBeenCalledTimes(1)
    expect(chat.send).toHaveBeenCalledWith({ content: '请查看这个文件', attachments: [PLAN] })
    expect(term.review).not.toHaveBeenCalled()
  })

  it('≥2 个附件 → 合成「请查看这些文件」', async () => {
    const { panel, session } = mountHarness(makeSession())
    const chat = session.chat as unknown as ChatSpy

    const ok = await panel.onSend({ content: '', attachments: [PLAN, ORDER] })

    expect(ok).toBe(true)
    expect(chat.send).toHaveBeenCalledWith({
      content: '请查看这些文件',
      attachments: [PLAN, ORDER],
    })
  })

  it('有正文 → **不合成**，逐字提交，并照常规做术语预检', async () => {
    const { panel, session } = mountHarness(makeSession())
    const chat = session.chat as unknown as ChatSpy
    const term = session.termNormalize as unknown as TermSpy

    await panel.onSend({ content: '帮我看看这份计划', attachments: [PLAN] })

    expect(chat.send).toHaveBeenCalledWith({
      content: '帮我看看这份计划',
      attachments: [PLAN],
    })
    expect(term.review).toHaveBeenCalledTimes(1)
  })

  it('无正文、无附件 → 仍拦截并提示（改造前行为不变）', async () => {
    const { panel, session } = mountHarness(makeSession())
    const chat = session.chat as unknown as ChatSpy
    const toast = session.toast as unknown as ToastSpy

    const ok = await panel.onSend({ content: '  ', attachments: [] })

    expect(ok).toBe(false)
    expect(chat.send).not.toHaveBeenCalled()
    expect(toast.push).toHaveBeenCalledWith('error', '请输入消息内容')
  })

  it('只有 `/技能名` 标记、无附件 → 仍拦截（技能标记被剥离后正文为空）', async () => {
    const { panel, session } = mountHarness(makeSession())
    const chat = session.chat as unknown as ChatSpy

    const ok = await panel.onSend({ content: '/demo ', attachments: [], skill: 'demo' })

    expect(ok).toBe(false)
    expect(chat.send).not.toHaveBeenCalled()
  })
})

describe('useChatPanel —— 正文长度上限（2026-11-26）', () => {
  it('超过上限 → 本地拦下并提示，不发请求', async () => {
    const { panel, session } = mountHarness(makeSession())
    const chat = session.chat as unknown as ChatSpy
    const toast = session.toast as unknown as ToastSpy

    const ok = await panel.onSend({
      content: 'a'.repeat(MAX_MESSAGE_CHARS + 1),
      attachments: [],
    })

    expect(ok).toBe(false)
    expect(chat.send).not.toHaveBeenCalled()
    expect(toast.push).toHaveBeenCalledWith(
      'error',
      expect.stringContaining(String(MAX_MESSAGE_CHARS)),
    )
  })

  it('恰好等于上限 → 正常提交', async () => {
    const { panel, session } = mountHarness(makeSession())
    const chat = session.chat as unknown as ChatSpy

    const ok = await panel.onSend({ content: 'a'.repeat(MAX_MESSAGE_CHARS), attachments: [] })

    expect(ok).toBe(true)
    expect(chat.send).toHaveBeenCalledTimes(1)
  })
})
