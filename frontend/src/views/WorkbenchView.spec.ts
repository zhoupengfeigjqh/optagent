/**
 * 组件测试：工作台视图（2026-09-28 从 `App.vue` 搬迁后）
 *
 * 守住两条口径：
 * 1. **会话上下文取自根组件**：本视图用 `useSession()` 取用那一份，MUST NOT 自己再
 *    `useAppSession()` 装配一套——两份状态会各自拉一次历史列表，并让"记住当前会话"
 *    在多个路由上双写地址栏（旧实现的缺陷）；
 * 2. **刷新恢复（002 特性）归工作台**：首屏拉完列表后按 `initialThreadId` 自动选中该会话；
 *    目标已不存在或加载失败时**静默**回空态并清除痕迹，不报错。
 *
 * 子组件全部打桩：它们同样消费会话上下文（各自的 `useXxx()` 访问器），本测试只关心
 * 本视图自身的行为，故不装配它们。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RUN_PHASE } from '@/constants/events'
import WorkbenchView from './WorkbenchView.vue'

/** 用 `vi.hoisted` 承载桩，避开 `vi.mock` 工厂的提升限制（与 `ProducedBell.spec.ts` 同一手法） */
const h = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('@/composables/useAppSession', () => ({ useSession: () => h.session }))

/** 中栏桩的挂载次数：012 的"不打扰"要求放大 / 缩回**不重建**中栏（草稿与滚动位置在它里面） */
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
  // 布尔桩不渲染插槽 ⇒ 子树（含侧栏）根本不挂载，也就无法派发事件。
  // `preview` 一并渲染：011 的放大接线要经右栏回到会话态（`data-maximized` 暴露收到的 prop）。
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
  // 侧栏用一个"点得出版本事件"的微型桩，用于验证视图的事件接线
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
  // 右栏桩：把「放大入口」与「Esc 请求退出」都做成点得出来的按钮（011 接线用）
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
}

/** 只造本视图会触碰的字段；其余由 `useSession()` 的消费方（子组件）负责，这里已打桩 */
function makeSession(initialThreadId: string | null, threadIds: string[]) {
  // 与真实装配同起点：装配期 ref 为 null，恢复是"事后"由 select 写入（见 useAppSession）
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
      // 009：「新建对话」＝视图态清空（不调创建接口）
      startNew: vi.fn(() => {
        activeThreadId.value = null
      }),
      showMore: vi.fn(),
      remove: vi.fn(),
      rename: vi.fn().mockResolvedValue(true),
      // 默认"拉取失败"（返回 null）：导出用例里点一下也不会真的去落盘
      exportMarkdown: vi.fn().mockResolvedValue(null),
      clearActive: vi.fn(() => {
        activeThreadId.value = null
      }),
    },
    chat: { phase: ref<string>(RUN_PHASE.IDLE) },
    preview: {
      open: ref(false),
      // 右栏插槽现在会被渲染（011 的接线要经它回来），故列表态 / 内容态字段也要齐
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

/**
 * 009 FR-010 / FR-022（会话按数字人隔离）：
 * 「新建对话」是**视图态**——只清空当前选中，**不**落盘。
 *
 * 若在这里调 `create()`，切换数字人一次就多一条"没有任何消息"的记录；
 * 而服务端列表只呈现有消息的会话（FR-016），用户会看到"点了没反应"。
 */
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

    // 先选中一个会话（模拟用户正在看历史），再点「新建对话」
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

    // jsdom 没有对象 URL 与导航实现：两个静态方法都要就地补上，并拦住锚点跳转
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

/**
 * 预览面板的放大 / 缩小接线（2026-10-16，011）。
 *
 * 本视图只做**转发**：状态与判据都在会话态（`usePreview`），这里断言的是
 * "面板的点按到达会话态"与"放大态到达骨架"这两段线接对了——判据本身在
 * `usePreview.spec.ts` 的 8 例矩阵里测（FR-010 的单一实现）。
 */
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
