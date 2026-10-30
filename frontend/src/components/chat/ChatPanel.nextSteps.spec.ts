/**
 * 组件测试：ChatPanel 与下一步动作卡片的接线（007 · US1/US2）。
 *
 * `useChatPanel()` 整体打桩——**发送链路与确认语义由 `useChatPanel.nextSteps.spec.ts` 用真实现覆盖**，
 * 本文件只钉住"本组件把谁接到谁"：
 * - 卡片数据来自 `nextSteps.steps` 并透传给 `MessageList`；
 * - 卡片点选一路向上到 `onPickNextStep`（**未确认前 MUST NOT 调用 `onSend`**，US2）；
 * - 确认弹窗的打开/确认/取消分别接到对应处理器。
 */
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStarter } from '../../api/types'
import ChatPanel from './ChatPanel.vue'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import MessageList from './MessageList.vue'

const h = vi.hoisted(() => ({ panel: null as unknown }))

vi.mock('../../composables/useChatPanel', () => ({ useChatPanel: () => h.panel }))

const ACTION: AgentStarter = {
  prompt: '按交付日期梳理这批订单的风险',
  tools: [{ kind: 'mcp', service: 'erp', name: 'query_order', exposed_name: 'erp__query_order' }],
  guidance: '本轮请优先使用以下工具完成任务：erp__query_order',
}

function makePanel(options: { pending?: AgentStarter | null; busy?: boolean } = {}) {
  const noop = vi.fn()
  return {
    chat: { draft: ref(''), thinkingEnabled: ref(false), canSend: ref(true) },
    // 015：`activeSource` 随会话列表下发（本组用例恒为普通会话）
    threads: { activeId: ref(null), activeSource: ref(null), messages: ref([]), hasMore: ref(false) },
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
    },
    workspace: { spaces: ref([]), loading: ref(false) },
    // 014：空数据引导状态（默认不出气泡）
    emptyHint: { visible: ref(false), dismiss: noop },
    agents: {
      currentAgent: ref({ agent_name: 'demo' }),
      candidates: ref([]),
      mcpServers: ref([]),
      switchingDisabled: ref(false),
      switchingDisabledReason: ref(null),
      switching: ref(false),
      loadCandidates: noop,
    },
    // 015：头部入口按钮读它（本组用例不涉及定时任务，取"未展开"即可）
    schedule: { panelOpen: ref(false), openPanel: noop },
    uploadOpen: ref(false),
    agentPanelOpen: ref(false),
    workspaceOpen: ref(false),
    streaming: ref(null),
    isFailed: ref(false),
    errorInfo: ref(null),
    sending: ref(false),
    hasMessages: ref(true),
    pendingUserMessage: ref(null),
    pendingInteraction: ref(null),
    interactionError: ref(null),
    onSubmitInteraction: noop,
    onRejectInteraction: noop,
    onSend: vi.fn(),
    onStop: noop,
    onRegenerate: noop,
    nextSteps: {
      steps: ref({ message_id: 'm-2', actions: [ACTION] }),
    },
    pendingSuggestion: ref<AgentStarter | null>(options.pending ?? null),
    suggestionSending: ref(options.busy ?? false),
    onPickNextStep: vi.fn(),
    onCancelSuggestion: vi.fn(),
    onConfirmSuggestion: vi.fn(),
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
    onRemoveReference: noop,
  }
}

/**
 * 打桩重型子组件，只放行本组用例关心的三件：`MessageList`（转发链）、
 * 卡片本体（`SuggestionCard` 由首屏用例覆盖）与 `ConfirmDialog`。
 * `BaseDialog` 换成朴素容器：避开 jsdom 对原生 `<dialog>` 的实现差异，
 * 同时把 `open` / `title` 暴露成可断言属性。
 */
function mountPanel() {
  return mount(ChatPanel, {
    props: { expanded: true },
    global: {
      stubs: {
        AgentPanel: true,
        ChatHeader: true,
        Composer: true,
        ComposerToolbar: true,
        InteractionDialog: true,
        MentionPicker: true,
        MentionPopup: true,
        ProducedBell: true,
        SessionSearch: true,
        UploadMenu: true,
        BaseDialog: {
          props: ['open', 'title'],
          template:
            '<div class="base-dialog-stub" :data-open="String(open)" :data-title="title"><slot /><slot name="footer" /></div>',
        },
      },
    },
  })
}

beforeEach(() => {
  h.panel = null
})

describe('ChatPanel —— 下一步动作卡片（007）', () => {
  it('卡片数据透传给 MessageList（点选事件向上接到 onPickNextStep）', async () => {
    const panel = makePanel()
    h.panel = panel

    const wrapper = mountPanel()
    const list = wrapper.findComponent(MessageList)

    expect(list.props('nextSteps')).toEqual({ message_id: 'm-2', actions: [ACTION] })

    list.vm.$emit('send-suggestion', ACTION)
    await wrapper.vm.$nextTick()

    expect(panel.onPickNextStep).toHaveBeenCalledWith(ACTION)
    // US2：点卡片只是"提出请求"，MUST NOT 直接发送
    expect(panel.onSend).not.toHaveBeenCalled()
  })

  it('未确认（pendingSuggestion 为空）→ 确认弹窗关闭态，且无可发送内容', () => {
    h.panel = makePanel({ pending: null })

    const wrapper = mountPanel()

    expect(wrapper.find('.base-dialog-stub').attributes('data-open')).toBe('false')
  })

  it('待确认 → 弹窗打开，标题与正文为提示词全文；确认/取消各接到对应处理器', async () => {
    const panel = makePanel({ pending: ACTION })
    h.panel = panel

    const wrapper = mountPanel()
    const dialog = wrapper.findComponent(ConfirmDialog)

    expect(wrapper.find('.base-dialog-stub').attributes('data-open')).toBe('true')
    expect(wrapper.find('.base-dialog-stub').attributes('data-title')).toBe('发送下一步动作')
    expect(wrapper.find('.confirm-dialog__message').text()).toBe(ACTION.prompt)

    await dialog.findAll('button')[0]!.trigger('click') // 取消
    expect(panel.onCancelSuggestion).toHaveBeenCalledTimes(1)
    expect(panel.onConfirmSuggestion).not.toHaveBeenCalled()

    await dialog.findAll('button')[1]!.trigger('click') // 发送
    expect(panel.onConfirmSuggestion).toHaveBeenCalledTimes(1)
    expect(panel.onSend).not.toHaveBeenCalled()
  })

  it('发送进行中 → 两个按钮均禁用（连点只发一次）', async () => {
    h.panel = makePanel({ pending: ACTION, busy: true })

    const wrapper = mountPanel()
    const buttons = wrapper.findComponent(ConfirmDialog).findAll('button')

    expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)
  })
})
