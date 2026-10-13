/**
 * 组件测试：ChatPanel 的 `@` 引用浮层接入（006 T304）。
 *
 * 守住两条：
 * 1. **浮层不推挤布局**（FR-101 / FR-130）：面板经 `Composer` 的 `#mention` 插槽就地挂载，
 *    坐标由脚本写死（`fixed` 语义的落点），打开前后锚点（输入框）的矩形完全一致；
 * 2. **引用芯片回归**（不变量 I-1）：`mention.references` → `.composer__refs` 的结构与
 *    "移除由上层决定"的上报口径不变。
 *
 * `useChatPanel()` 整体打桩（与 `ChatPanel.starters.spec.ts` 同口径）：事件编排已收敛在
 * 该组合式函数里（另有其自身用例覆盖），本测试只关心"插槽 + 面板 + 芯片"这段渲染接线。
 * 无关子组件一律 stub——本文件要的是**真**的 `Composer` 与 `MentionPopup`，其余越轻越好。
 */
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    references?: Array<{ dir: string; filename: string }>
    onRemoveReference?: ReturnType<typeof vi.fn>
  } = {},
) {
  const noop = vi.fn()
  return {
    chat: { draft: ref(''), thinkingEnabled: ref(false), canSend: ref(true) },
    threads: { messages: ref([]), hasMore: ref(false) },
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
      candidates: ref([]),
      mcpServers: ref([]),
      switchingDisabled: ref(false),
      switching: ref(false),
    },
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
    onSend: noop,
    onStop: noop,
    onRegenerate: noop,
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

function setup(options: Parameters<typeof makePanel>[0] = {}) {
  const panel = makePanel(options)
  h.panel = panel
  const wrapper = mount(ChatPanel, { props: { expanded: false }, global: { stubs: STUBS } })
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

    const anchor = wrapper.find('textarea.composer__input')
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

  it('引用芯片接线回归：`@文件名` + 移除按钮，点击上报原引用（不变量 I-1）', async () => {
    const reference = { dir: '数据准备/生产计划', filename: 'plan.csv' }
    const onRemoveReference = vi.fn()
    const { wrapper } = setup({ references: [reference], onRemoveReference })

    expect(wrapper.findAll('.composer__ref')).toHaveLength(1)
    expect(wrapper.find('.composer__ref-text').text()).toBe('@plan.csv')

    await wrapper.find('.composer__ref-remove').trigger('click')

    // 是否真的移除由上层决定，组件只上报（与 Composer 的契约一致）
    expect(onRemoveReference).toHaveBeenCalledWith(reference)

    wrapper.unmount()
  })
})
