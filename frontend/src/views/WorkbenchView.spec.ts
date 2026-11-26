import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RUN_PHASE } from '@/constants/events'
import WorkbenchView from './WorkbenchView.vue'

const h = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('@/composables/useAppSession', () => ({ useSession: () => h.session }))

let chatMounts = 0

const ChatPanelStub = defineComponent({
  name: 'ChatPanel',
  props: { expanded: Boolean },
  setup() {
    chatMounts += 1
    return {}
  },
  template: '<div class="chat-stub" />',
})

const stubs = {
  // `AppShell` 必须**渲染插槽**：三栏内容都经它的具名插槽下发，
  AppShell: {
    name: 'AppShell',
    props: { previewOpen: Boolean, previewMaximized: Boolean },
    template: [
      '<div class="shell-stub" :data-maximized="String(previewMaximized)">',
      '<slot name="history" />',
      '<slot name="chat" />',
      '<slot name="preview" />',
      '</div>',
    ].join(''),
  },
  HistorySidebar: {
    name: 'HistorySidebar',
    template: [
      '<aside class="sidebar-stub">',
      '<button class="sidebar-create" @click="$emit(\'create\')" />',
      "<button class=\"sidebar-rename\" @click=\"$emit('rename', { threadId: 't1', title: '改名后' })\" />",
      '<button class="sidebar-export" @click="$emit(\'export\', \'t1\')" />',
      '</aside>',
    ].join(''),
  },
  ChatPanel: ChatPanelStub,
  WorkspacePanel: {
    name: 'WorkspacePanel',
    props: { maximizeVisible: Boolean, maximized: Boolean },
    template: [
      '<div class="panel-stub">',
      '<button v-if="maximizeVisible" class="panel-toggle" @click="$emit(\'toggle-maximize\')" />',
      '<button v-if="maximized" class="panel-restore" @click="$emit(\'restore-maximize\')" />',
      '</div>',
    ].join(''),
  },
  ToastHost: true,
  ConfirmDialog: true,
  SchedulePanel: true,
}

function makeSession(initialThreadId: string | null, threadIds: string[]) {
  const activeThreadId = ref<string | null>(null)
  // 011：放大态的三个派生值与两个动作，按真实 `usePreview` 的语义模拟（懒切换、退出幂等）
  const maximized = ref(false)
  const maximizable = ref(false)
  return {
    initialThreadId,
    rememberActiveThread: vi.fn(),
    threads: {
      list: ref(threadIds.map((id) => ({ thread_id: id, title: id }))),
      activeId: activeThreadId,
      limit: ref(10),
      loading: ref(false),
      running: ref(false),
      messages: ref([]),
      error: ref<string | null>(null),
      loadList: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
      startNew: vi.fn(() => {
        activeThreadId.value = null
      }),
      showMore: vi.fn(),
      remove: vi.fn(),
      rename: vi.fn().mockResolvedValue(true),
      exportMarkdown: vi.fn().mockResolvedValue(null),
      clearActive: vi.fn(() => {
        activeThreadId.value = null
      }),
    },
    chat: { phase: ref<string>(RUN_PHASE.IDLE), thinkingEnabled: ref(false) },
    schedule: {
      panelOpen: ref(false),
      tasks: ref([]),
      loading: ref(false),
      error: ref(null),
      degraded: ref(false),
      pendingIds: ref([]),
      creating: ref(false),
      runs: ref([]),
      runsTotal: ref(0),
      runsLoading: ref(false),
      runsError: ref(null),
      create: vi.fn().mockResolvedValue(true),
      update: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true),
      setEnabled: vi.fn(),
      loadRuns: vi.fn(),
      load: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      openPanel: vi.fn(),
      closePanel: vi.fn(),
      onAgentSwitched: vi.fn(),
    },
    preview: {
      open: ref(false),
      view: ref<string>('list'),
      target: ref({ kind: 'none' }),
      content: ref<unknown>(null),
      loading: ref(false),
      maximized,
      maximizable,
      maximizeToggleVisible: computed(() => maximized.value || maximizable.value),
      toggleMaximize: vi.fn(() => {
        maximized.value = !maximized.value
      }),
      restoreMaximize: vi.fn(() => {
        maximized.value = false
      }),
      close: vi.fn(),
      backToList: vi.fn(),
      openFile: vi.fn(),
      download: vi.fn(),
      onFileRemoved: vi.fn(),
    },
    workspace: {
      spaces: ref([]),
      expandedSpaces: ref([]),
      expandedDirs: ref([]),
      loading: ref(false),
      toggleSpace: vi.fn(),
      toggleDir: vi.fn(),
      remove: vi.fn(),
    },
    toast: { items: ref([]), dismiss: vi.fn(), runAction: vi.fn() },
  }
}

function mountView() {
  return mount(WorkbenchView, { global: { stubs } })
}

beforeEach(() => {
  h.session = null
})

describe('WorkbenchView —— 会话上下文与刷新恢复', () => {
  it('挂载即拉一次历史列表；命中 initialThreadId 时自动选中（刷新恢复生效）', async () => {
    const session = makeSession('t1', ['t1', 't2'])
    h.session = session

    mountView()
    await flushPromises()

    expect(session.threads.loadList).toHaveBeenCalledTimes(1)
    expect(session.threads.select).toHaveBeenCalledWith('t1')
  })

  it('目标会话已不存在 → 静默回空态并清除痕迹（不选中、不报错）', async () => {
    const session = makeSession('gone', ['t1'])
    h.session = session

    mountView()
    await flushPromises()

    expect(session.threads.select).not.toHaveBeenCalled()
    expect(session.threads.clearActive).toHaveBeenCalled()
    expect(session.rememberActiveThread).toHaveBeenCalledWith(null)
  })

  it('无 initialThreadId → 只拉列表，不选中任何会话', async () => {
    const session = makeSession(null, ['t1'])
    h.session = session

    mountView()
    await flushPromises()

    expect(session.threads.loadList).toHaveBeenCalledTimes(1)
    expect(session.threads.select).not.toHaveBeenCalled()
  })

  it('会话切换即记住（地址栏 + 本地存储双写，供下次刷新恢复）', async () => {
    const session = makeSession(null, ['t1'])
    h.session = session

    mountView()
    await flushPromises()

    session.threads.activeId.value = 't1'
    await flushPromises()

    expect(session.rememberActiveThread).toHaveBeenCalledWith('t1')
  })
})

describe('WorkbenchView —— 新建对话＝空对话视图（009）', () => {
  it('侧栏「新建对话」→ 调 startNew，且**不**调创建接口', async () => {
    const session = makeSession(null, ['t1'])
    h.session = session

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.sidebar-create').trigger('click')
    await flushPromises()

    expect(session.threads.startNew).toHaveBeenCalledTimes(1)
    expect(session.threads.create).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('新建对话后当前选中被清空（回到空态视图），不再指向原会话', async () => {
    const session = makeSession(null, ['t1'])
    h.session = session

    const wrapper = mountView()
    await flushPromises()

    await session.threads.select('t1')
    session.threads.activeId.value = 't1'
    await flushPromises()

    await wrapper.find('.sidebar-create').trigger('click')
    await flushPromises()

    expect(session.threads.activeId.value).toBeNull()
    wrapper.unmount()
  })
})

/**
 * 侧栏的会话重命名与导出（2026-10-16）。
 *
 * 本视图只负责**转发与落盘**：标题的乐观更新/回滚在 `useThreads.rename`，
 * 全文拉取在 `useThreads.exportMarkdown`（各自的用例覆盖其内部细节）。
 */
describe('WorkbenchView —— 会话重命名 / 导出（2026-10-16）', () => {
  it('侧栏重命名 → 转交 `threads.rename`（载荷原样透传）', async () => {
    const session = makeSession(null, ['t1'])
    h.session = session
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.sidebar-rename').trigger('click')
    await flushPromises()

    expect(session.threads.rename).toHaveBeenCalledWith('t1', '改名后')
    wrapper.unmount()
  })

  it('导出失败（store 返回 null）→ 不产生任何下载（不留半截空文件）', async () => {
    const session = makeSession(null, ['t1'])
    h.session = session
    const createObjectURL = vi.fn(() => 'blob:fake')
    const originalCreate = URL.createObjectURL
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL

    const wrapper = mountView()
    await flushPromises()
    await wrapper.find('.sidebar-export').trigger('click')
    await flushPromises()

    expect(session.threads.exportMarkdown).toHaveBeenCalledWith('t1')
    expect(createObjectURL).not.toHaveBeenCalled()

    URL.createObjectURL = originalCreate
    wrapper.unmount()
  })

  it('导出成功 → 交给浏览器下载（Blob + `a[download]` 各触发一次）', async () => {
    const session = makeSession(null, ['t1'])
    session.threads.exportMarkdown.mockResolvedValue('# 标题\n')
    h.session = session

    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    const createObjectURL = vi.fn(() => 'blob:fake')
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const wrapper = mountView()
    await flushPromises()
    await wrapper.find('.sidebar-export').trigger('click')
    await flushPromises()

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)

    clickSpy.mockRestore()
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
    wrapper.unmount()
  })
})

describe('WorkbenchView —— 放大 / 缩小接线（011）', () => {
  it('可放大内容下入口出现；点击转交 `preview.toggleMaximize`，放大态再回传给骨架', async () => {
    const session = makeSession(null, ['t1'])
    session.preview.maximizable.value = true
    h.session = session

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.shell-stub').attributes('data-maximized')).toBe('false')
    expect(wrapper.find('.panel-toggle').exists()).toBe(true)

    await wrapper.find('.panel-toggle').trigger('click')
    await flushPromises()

    expect(session.preview.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(session.preview.maximized.value).toBe(true)
    expect(wrapper.find('.shell-stub').attributes('data-maximized')).toBe('true')
    wrapper.unmount()
  })

  it('不可放大且未放大时入口不渲染（范围内外只由会话态决定，本视图不判第二遍）', async () => {
    const session = makeSession(null, ['t1'])
    h.session = session

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.panel-toggle').exists()).toBe(false)
    wrapper.unmount()
  })

  it('已经处于放大态时入口仍在（放大态下切到加载中的目标也不能丢了出口，FR-005）', async () => {
    const session = makeSession(null, ['t1'])
    session.preview.maximized.value = true
    h.session = session

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.panel-toggle').exists()).toBe(true)
    wrapper.unmount()
  })

  it('面板请求退出（Esc）→ 转交 `preview.restoreMaximize`，架子随即收到非放大态', async () => {
    const session = makeSession(null, ['t1'])
    session.preview.maximized.value = true
    h.session = session

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.panel-restore').trigger('click')
    await flushPromises()

    expect(session.preview.restoreMaximize).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.shell-stub').attributes('data-maximized')).toBe('false')
    wrapper.unmount()
  })

  it('放大 / 缩回**不重建**中栏：草稿与滚动位置所在的那棵树原地不动（FR-030）', async () => {
    const session = makeSession(null, ['t1'])
    session.preview.maximizable.value = true
    h.session = session

    const wrapper = mountView()
    await flushPromises()

    const mountsBefore = chatMounts
    const chatNode = wrapper.find('.chat-stub').element

    await wrapper.find('.panel-toggle').trigger('click')
    await flushPromises()
    await wrapper.find('.panel-restore').trigger('click')
    await flushPromises()

    expect(chatMounts).toBe(mountsBefore)
    expect(wrapper.find('.chat-stub').element).toBe(chatNode)
    wrapper.unmount()
  })
})
