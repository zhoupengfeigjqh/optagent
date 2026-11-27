import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel from './ChatPanel.vue'

const h = vi.hoisted(() => ({ panel: null as unknown }))

vi.mock('../../composables/useChatPanel', () => ({ useChatPanel: () => h.panel }))

function agent(overrides: Record<string, unknown> = {}) {
  return {
    agent_name: 'demo',
    intro: '订单交付助理',
    welcome: '',
    starters: [],
    soul: '',
    skills: [],
    enabled_tools: [],
    mcp_servers: [],
    ...overrides,
  }
}

function makePanel(options: { agent?: unknown; onSend?: ReturnType<typeof vi.fn> } = {}) {
  const noop = vi.fn()
  return {
    chat: {
      draft: ref(''),
      thinkingEnabled: ref(false),
      planProgress: ref([]),
    },
    threads: {
      activeId: ref(null),
      activeSource: ref(null),
      messages: ref([]),
      hasMore: ref(false),
    },
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
    emptyHint: { visible: ref(false), dismiss: noop },
    agents: {
      currentAgent: ref(options.agent ?? null),
      accessState: ref('ready'),
      error: ref(null),
      candidates: ref([]),
      mcpServers: ref([]),
      switchingDisabled: ref(false),
      switchingDisabledReason: ref(null),
      switching: ref(false),
      loadCandidates: vi.fn(),
    },
    schedule: { panelOpen: ref(false), openPanel: noop },
    uploadOpen: ref(false),
    agentPanelOpen: ref(false),
    workspaceOpen: ref(false),
    streaming: ref(null),
    isFailed: ref(false),
    errorInfo: ref(null),
    sending: ref(false),
    hasMessages: ref(false),
    pendingUserMessage: ref(null),
    pendingInteraction: ref(null),
    interactionError: ref(null),
    onSubmitInteraction: noop,
    onRejectInteraction: noop,
    onSend: options.onSend ?? noop,
    onStop: noop,
    onRegenerate: noop,
    nextSteps: { steps: ref({ message_id: null, actions: [] }) },
    pendingSuggestion: ref(null),
    suggestionSending: ref(false),
    onPickNextStep: noop,
    onCancelSuggestion: noop,
    onConfirmSuggestion: noop,
    onLoadMore: noop,
    onRecover: noop,
    onFeedback: noop,
    onToggleThinking: noop,
    onSelectModel: noop,
    onToggleUpload: noop,
    onCloseUpload: noop,
    onPickFiles: noop,
    onPasteFiles: noop,
    onRetryUpload: noop,
    onToggleSearch: noop,
    onToggleWorkspace: noop,
    onSearchKeyword: noop,
    onOpenAgentPanel: noop,
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
    skill: {
      selected: ref<string | null>(null),
      open: ref(false),
      caret: ref(0),
      filtered: ref([]),
      loading: ref(false),
      error: ref(''),
      activeIndex: ref(0),
      close: noop,
      move: noop,
    },
    onPickSkill: noop,
    onConfirmSkill: noop,
    onSkillKey: noop,
    onRemoveSkill: noop,
  }
}

function mountPanel() {
  return mount(ChatPanel, {
    props: { expanded: false },
    global: {
      stubs: {
        AgentPanel: true,
        ChatHeader: true,
        Composer: true,
        ComposerToolbar: true,
        ConfirmDialog: true,
        InteractionDialog: true,
        MentionPicker: true,
        MentionPopup: true,
        MessageList: true,
        ProducedBell: true,
        SessionSearch: true,
        UploadMenu: true,
      },
    },
  })
}

beforeEach(() => {
  h.panel = null
})

describe('ChatPanel —— 新建对话页的首屏引导（004）', () => {
  it('渲染欢迎语与全部问题卡片，点击卡片即发起对话（正文干净 + 隐藏引导）', async () => {
    const onSend = vi.fn()
    h.panel = makePanel({
      agent: agent({
        welcome: '你好，我是交付助理',
        starters: [
          {
            prompt: '帮我梳理昨天订单的交付风险',
            tools: [
              {
                kind: 'mcp',
                service: 'erp',
                name: 'query_order',
                exposed_name: 'erp__query_order',
              },
            ],
            guidance: '本轮请优先使用以下工具完成任务：erp__query_order',
          },
          { prompt: '这个月哪些订单可能延期？', tools: [], guidance: '' },
        ],
      }),
      onSend,
    })

    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('你好，我是交付助理')
    expect(wrapper.findAll('[data-test^="chat-starter-"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('这个月哪些订单可能延期？')

    await wrapper.find('[data-test="chat-starter-0"]').trigger('click')

    expect(onSend).toHaveBeenCalledWith({
      content: '帮我梳理昨天订单的交付风险',
      attachments: [],
      guidance: '本轮请优先使用以下工具完成任务：erp__query_order',
      skipIntentFocus: true,
    })
  })

  it('关联工具不在卡片上展示（只用于生成隐藏引导；exposed_name 是内部实现细节）', () => {
    h.panel = makePanel({
      agent: agent({
        welcome: '你好',
        starters: [
          {
            prompt: '帮我梳理昨天订单的交付风险',
            tools: [
              {
                kind: 'mcp',
                service: 'erp',
                name: 'query_order',
                exposed_name: 'erp__query_order',
              },
              { kind: 'builtin', name: 'read_file', exposed_name: 'read_file' },
            ],
            guidance: '本轮请优先使用以下工具完成任务：erp__query_order',
          },
        ],
      }),
    })

    const wrapper = mountPanel()
    expect(wrapper.find('[data-test="chat-starter-0"]').text()).toBe('帮我梳理昨天订单的交付风险')
    expect(wrapper.text()).not.toContain('erp__query_order')
  })

  it('无关联工具的问题实例不带 guidance 键（后端 Schema 为 additionalProperties:false）', async () => {
    const onSend = vi.fn()
    h.panel = makePanel({
      agent: agent({
        welcome: '你好',
        starters: [{ prompt: '这个月哪些订单可能延期？', tools: [], guidance: '' }],
      }),
      onSend,
    })

    const wrapper = mountPanel()
    await wrapper.find('[data-test="chat-starter-0"]').trigger('click')

    expect(onSend).toHaveBeenCalledWith({
      content: '这个月哪些订单可能延期？',
      attachments: [],
      skipIntentFocus: true,
    })
  })

  it('存量数字人（无结构化 SOUL）→ 退回既有空状态文案，不白屏', () => {
    h.panel = makePanel({ agent: agent({ soul: '# 老 SOUL 全文', intro: '' }) })

    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('开始新的对话')
    expect(wrapper.findAll('[data-test^="chat-starter-"]')).toHaveLength(0)
  })

  it('未选数字人 → 提示先选择数字人', () => {
    h.panel = makePanel({ agent: null })

    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('请先选择数字人')
  })
})
