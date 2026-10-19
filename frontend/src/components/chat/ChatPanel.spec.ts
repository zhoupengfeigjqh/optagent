/**
 * 组件测试：ChatPanel 的 `@` 引用浮层接入（006 T304）。
 *
 * 守住两条：
 * 1. **浮层不推挤布局**（FR-101 / FR-130）：面板经 `Composer` 的 `#mention` 插槽就地挂载，
 *    坐标由脚本写死（`fixed` 语义的落点），打开前后锚点（输入框）的矩形完全一致；
 * 2. **引用胶囊回归**（不变量 I-1，2026-10-18 起为正文内联）：`草稿 + mention.references`
 *    → `.composer__mention` 的结构与"移除由上层决定"的上报口径不变。
 *
 * `useChatPanel()` 整体打桩（与 `ChatPanel.starters.spec.ts` 同口径）：事件编排已收敛在
 * 该组合式函数里（另有其自身用例覆盖），本测试只关心"插槽 + 面板 + 芯片"这段渲染接线。
 * 无关子组件一律 stub——本文件要的是**真**的 `Composer` 与 `MentionPopup`，其余越轻越好。
 */
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { emptyNextSteps } from '../../api/next-steps'
import type { ErrorInfo, Message } from '../../api/types'
import ChatPanel from './ChatPanel.vue'

const h = vi.hoisted(() => ({ panel: null as unknown }))

vi.mock('../../composables/useChatPanel', () => ({ useChatPanel: () => h.panel }))

/** 与浮层无关的重子组件：stub 掉（它们各自有独立用例与数据源） */
const STUBS = {
  ChatHeader: true,
  SessionSearch: true,
  MessageList: true,
  UploadMenu: true,
  AgentPanel: true,
  InteractionDialog: true,
  ProducedBell: true,
}

function makePanel(
  options: {
    /** 草稿（胶囊由「草稿 + 引用」共同决定：正文里没有标记就不该有胶囊） */
    draft?: string
    references?: Array<{ dir: string; filename: string }>
    onRemoveReference?: ReturnType<typeof vi.fn>
  } = {},
) {
  const noop = vi.fn()
  return {
    chat: { draft: ref(options.draft ?? ''), thinkingEnabled: ref(false), canSend: ref(true) },
    threads: { activeId: ref(null), messages: ref([]), hasMore: ref(false) },
    search: {
      isOpen: ref(false),
      keyword: ref(''),
      total: ref(0),
      activeIndex: ref(0),
      next: noop,
      close: noop,
    },
    models: { current: ref(null), models: ref([]) },
    uploads: { items: ref([]) },
    mention: {
      references: ref(options.references ?? []),
      open: ref(false),
      // `caret` 由状态机记录（浮层定位读它）；缺了会直接抛错，故这里显式给出
      caret: ref(0),
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
    },
    workspace: { spaces: ref([]), loading: ref(false) },
    agents: {
      currentAgent: ref(null),
      candidates: ref<Array<{ agent_name: string }>>([]),
      mcpServers: ref([]),
      switchingDisabled: ref(false),
      switchingDisabledReason: ref(null),
      switching: ref(false),
      // 009：陈旧数字人降级时面板会主动拉一次候选清单（用于"现在还能选谁"）
      loadCandidates: noop,
    },
    uploadOpen: ref(false),
    agentPanelOpen: ref(false),
    workspaceOpen: ref(false),
    // 本轮瞬态：本组用例只关心「失败块分流」读的 `canRegenerate`（形状按需最小化）
    streaming: ref<{ phase: string; canRegenerate: boolean } | null>(null),
    isFailed: ref(false),
    errorInfo: ref<ErrorInfo | null>(null),
    sending: ref(false),
    hasMessages: ref(false),
    pendingUserMessage: ref(null),
    pendingInteraction: ref(null),
    interactionError: ref(null),
    onSubmitInteraction: noop,
    onRejectInteraction: noop,
    onSend: noop,
    onStop: noop,
    onRegenerate: noop,
    onRetryTurn: noop,
    onRetryFailedRun: noop,
    // 007：列表渲染会读卡片快照与确认弹窗状态（本组用例不涉及卡片，取空形态即可）
    nextSteps: { steps: ref(emptyNextSteps()) },
    pendingSuggestion: ref(null),
    suggestionSending: ref(false),
    onPickNextStep: noop,
    onCancelSuggestion: noop,
    onConfirmSuggestion: noop,
    onLoadMore: noop,
    onLoadToolResult: noop,
    onRecover: noop,
    onFeedback: noop,
    onToggleThinking: noop,
    onSelectModel: noop,
    onToggleUpload: noop,
    onCloseUpload: noop,
    onPickFiles: noop,
    onRetryUpload: noop,
    onToggleSearch: noop,
    onToggleWorkspace: noop,
    onSearchKeyword: noop,
    onToggleAgent: noop,
    onCloseAgentPanel: noop,
    onSwitchAgent: noop,
    onOpenLink: noop,
    onOpenFile: noop,
    onUpdateDraft: noop,
    onSendFromToolbar: noop,
    onInputText: noop,
    onPickSpace: noop,
    onPickDir: noop,
    onPickFile: noop,
    onConfirmMention: noop,
    onMentionKey: noop,
    onRemoveReference: options.onRemoveReference ?? noop,
  }
}

type Panel = ReturnType<typeof makePanel>

/** 需要真消息列表时用它替换 `STUBS`（`false` = 不 stub，渲染真实组件） */
const REAL_LIST_STUBS = { ...STUBS, MessageList: false }

function setup(options: Parameters<typeof makePanel>[0] = {}, stubs: typeof STUBS = STUBS) {
  const panel = makePanel(options)
  h.panel = panel
  const wrapper = mount(ChatPanel, { props: { expanded: false }, global: { stubs } })
  return { wrapper, panel }
}

/** 视口坐标四元组（DOMRect 的属性在原型上，逐项取值比较更稳） */
function rectOf(element: Element): { left: number; top: number; width: number; height: number } {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

beforeEach(() => {
  h.panel = null
})

describe('ChatPanel —— @ 引用浮层（006）', () => {
  it('浮层经 #mention 插槽就地挂载：坐标由脚本写入，锚点矩形不被推挤', async () => {
    const { wrapper, panel } = setup()

    const anchor = wrapper.find('.composer__input')
    expect(anchor.exists()).toBe(true)
    const before = rectOf(anchor.element)
    expect(wrapper.find('.mention-popup').exists()).toBe(false)

    ;(panel as Panel).mention.open.value = true
    await nextTick()
    await nextTick()

    const popup = wrapper.find('.mention-popup')
    expect(popup.exists()).toBe(true)
    // 就地挂载：面板仍在 Composer 的 DOM 子树内（不 Teleport），
    // 因此它属于所在 <dialog> 的内容，`inert` 挡不住点击
    expect(popup.element.closest('.composer')).not.toBeNull()
    // 落点是脚本写入的视口坐标（fixed 语义），而不是靠流内排版占位
    expect(popup.attributes('style')).toContain('left:')
    expect(popup.attributes('style')).toContain('top:')
    // 打开前后锚点矩形完全一致：浮层不参与文档流（FR-101）
    expect(rectOf(anchor.element)).toEqual(before)

    wrapper.unmount()
  })

  it('引用胶囊接线：正文里的 `@文件名` + 移除按钮，点击上报原引用（I-1）', async () => {
    const reference = { dir: '数据准备/生产计划', filename: 'plan.csv' }
    const onRemoveReference = vi.fn()
    const { wrapper } = setup({
      draft: '看下 @plan.csv 的数据',
      references: [reference],
      onRemoveReference,
    })

    expect(wrapper.findAll('.composer__mention')).toHaveLength(1)
    expect(wrapper.find('.composer__mention').text()).toBe('@plan.csv')
    // 旧的上方 chip 行已并入正文：同一次选择只显示一处
    expect(wrapper.find('.composer__refs').exists()).toBe(false)

    await wrapper.find('.composer__mention-remove').trigger('click')

    // 是否真的移除由上层决定，组件只上报（与 Composer 的契约一致）
    expect(onRemoveReference).toHaveBeenCalledWith(reference)

    wrapper.unmount()
  })
})

/**
 * 失败轮「重试本轮」的接线（2026-10-15 断链修复）。
 *
 * 病灶是**事件悬空**：气泡发 `retry`、列表层也透传了，但面板模板没接——
 * 按钮点下去什么都不发生。故这里渲染**真实**列表与气泡，只问一件事：
 * 点下去之后，装配层（`onRetryTurn`）是否收到了"该轮的用户消息"这个载荷。
 * （`onRetryTurn → onSend` 这一段由 `useChatPanel.retry.spec.ts` 用真链路覆盖。）
 */
describe('ChatPanel —— 失败轮「重试本轮」的接线', () => {
  it('气泡里的重试入口把该轮的用户消息交给装配层（不再是点了没反应的按钮）', async () => {
    const { wrapper, panel } = setup({}, REAL_LIST_STUBS)
    const threads = (panel as Panel).threads as { messages: { value: Message[] } }
    const retryTurn = (panel as Panel).onRetryTurn as unknown as ReturnType<typeof vi.fn>

    threads.messages.value = [
      {
        id: 'm_u1',
        role: 'user',
        content: '帮我看看这份计划',
        ts: '2026-10-15T09:00:00Z',
        feedback: null,
        attachments: [{ dir: '数据准备/生产计划', filename: 'plan.csv' }],
      },
      {
        id: 'm_a1',
        role: 'assistant',
        content: '',
        ts: '2026-10-15T09:00:01Z',
        feedback: null,
        status: 'failed',
        error: { code: 'LLM_UNAVAILABLE', message: 'upstream 503' },
      },
    ]
    ;(panel as Panel).hasMessages.value = true
    await nextTick()

    const retry = wrapper.find('.error-notice__retry')
    expect(retry.exists()).toBe(true)
    await retry.trigger('click')

    expect(retryTurn).toHaveBeenCalledWith({
      content: '帮我看看这份计划',
      attachments: [{ dir: '数据准备/生产计划', filename: 'plan.csv' }],
    })

    wrapper.unmount()
  })
})

/**
 * 面板级失败块的按钮分流（TR-58，2026-10-15）。
 *
 * 本层断言两件事：**文案**随 `streaming.canRegenerate` 切换（用户可见的分流信号），
 * 以及点击**确实落到面板的重试入口**（`onRetryFailedRun`）——即"接线不悬空"。
 * 分流本身（可重发 → `onRegenerate`；不可重发 → `onRecover`）由
 * `useChatPanel.retry.spec.ts` 用真实组合式函数覆盖。
 */
describe('ChatPanel —— 面板级失败块的按钮分流', () => {
  it('本轮可重发：按钮是「重试本轮」，点击落到面板重试入口', async () => {
    const { wrapper, panel } = setup()

    ;(panel as Panel).isFailed.value = true
    ;(panel as Panel).errorInfo.value = { code: 'LLM_UNAVAILABLE', message: '' }
    ;(panel as Panel).streaming.value = { phase: 'failed', canRegenerate: true }
    await nextTick()

    const retry = wrapper.find('.chat-panel__error .error-notice__retry')
    expect(retry.exists()).toBe(true)
    expect(retry.text()).toBe('重试本轮')

    await retry.trigger('click')

    expect((panel as Panel).onRetryFailedRun).toHaveBeenCalledTimes(1)
  })

  it('本轮不可重发（断连，缓存未置位）：按钮仍是「重新获取」，点击同样落到面板重试入口', async () => {
    const { wrapper, panel } = setup()

    ;(panel as Panel).isFailed.value = true
    ;(panel as Panel).errorInfo.value = { code: 'NETWORK_ERROR', message: '' }
    ;(panel as Panel).streaming.value = { phase: 'failed', canRegenerate: false }
    await nextTick()

    const retry = wrapper.find('.chat-panel__error .error-notice__retry')
    expect(retry.text()).toBe('重新获取')

    await retry.trigger('click')

    expect((panel as Panel).onRetryFailedRun).toHaveBeenCalledTimes(1)
  })
})

/**
 * 009 FR-032 / FR-052：数字人不可用的降级必须**用户可感知**。
 *
 * 落在既有 `ErrorNotice` 提示位（不新增控件）：第一行给"为什么失败"，
 * 第二行（`hint`）给"现在还能选谁"。
 */
describe('ChatPanel —— 数字人不可用的降级呈现（009）', () => {
  it('陈旧数字人：错误态给出原因文案 + 当前可用数字人清单，并主动拉一次候选', async () => {
    const { wrapper, panel } = setup()
    const agents = (panel as Panel).agents as {
      candidates: { value: unknown[] }
      loadCandidates: ReturnType<typeof vi.fn>
    }
    agents.candidates.value = [{ agent_name: 'agent-a' }, { agent_name: 'agent-b' }]

    ;(panel as Panel).isFailed.value = true
    ;(panel as Panel).errorInfo.value = { code: 'AGENT_NOT_AVAILABLE', message: '' }
    await nextTick()

    const notice = wrapper.find('.error-notice')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('不可用')
    expect(wrapper.find('.error-notice__hint').text()).toBe('可切换的数字人：agent-a、agent-b')
    expect(agents.loadCandidates).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('候选清单尚未加载：hint 回落到"请重新选择数字人"（不显示空提示）', async () => {
    const { wrapper, panel } = setup()

    ;(panel as Panel).isFailed.value = true
    ;(panel as Panel).errorInfo.value = { code: 'AGENT_NOT_AVAILABLE', message: '' }
    await nextTick()

    expect(wrapper.find('.error-notice__hint').text()).toBe('请重新选择数字人')

    wrapper.unmount()
  })

  it('其它错误码：不出现 hint 行（不把所有错误都说成"数字人不可用"）', async () => {
    const { wrapper, panel } = setup()

    ;(panel as Panel).isFailed.value = true
    ;(panel as Panel).errorInfo.value = { code: 'THREAD_NOT_FOUND', message: '' }
    await nextTick()

    expect(wrapper.find('.error-notice').exists()).toBe(true)
    expect(wrapper.find('.error-notice__hint').exists()).toBe(false)

    wrapper.unmount()
  })
})

/**
 * Esc 中断本轮（2026-10-16）。
 *
 * 只钉"接线 + 优先级瀑布"两件事：按下去是否落到中断入口（`onStop`），以及
 * 弹窗 / `@引用`面板打开时**不许误伤**正在输出的回答。中断本身的行为
 * （POST /stop、本轮不落盘）由 `useChatStream` 的用例覆盖。
 */
describe('ChatPanel —— Esc 中断本轮（2026-10-16）', () => {
  function pressEscape(): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
  }

  it('流式进行中按 Esc：落到中断入口（等价于点「终止」）', async () => {
    const { wrapper, panel } = setup()
    ;(panel as Panel).sending.value = true
    await nextTick()

    pressEscape()

    expect((panel as Panel).onStop).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('本轮未在流式：Esc 不触发中断（不产生无意义的 stop 请求）', async () => {
    const { wrapper, panel } = setup()
    await nextTick()

    pressEscape()

    expect((panel as Panel).onStop).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('原生弹窗打开：Esc 让给弹窗关闭（优先级 1），不中断本轮', async () => {
    const { wrapper, panel } = setup()
    ;(panel as Panel).sending.value = true
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)
    await nextTick()

    pressEscape()

    expect((panel as Panel).onStop).not.toHaveBeenCalled()
    dialog.remove()
    wrapper.unmount()
  })

  it('`@引用`面板打开：Esc 归面板（优先级 2），不重复消费也不中断本轮', async () => {
    const { wrapper, panel } = setup()
    ;(panel as Panel).sending.value = true
    ;(panel as Panel).mention.open.value = true
    await nextTick()

    pressEscape()

    expect((panel as Panel).onStop).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('卸载后不再响应 Esc（监听已摘除，不留悬挂回调）', async () => {
    const { wrapper, panel } = setup()
    ;(panel as Panel).sending.value = true
    await nextTick()
    wrapper.unmount()

    pressEscape()

    expect((panel as Panel).onStop).not.toHaveBeenCalled()
  })
})
