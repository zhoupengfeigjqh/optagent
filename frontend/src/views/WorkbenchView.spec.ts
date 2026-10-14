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
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RUN_PHASE } from '@/constants/events'
import WorkbenchView from './WorkbenchView.vue'

/** 用 `vi.hoisted` 承载桩，避开 `vi.mock` 工厂的提升限制（与 `ProducedBell.spec.ts` 同一手法） */
const h = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('@/composables/useAppSession', () => ({ useSession: () => h.session }))

const stubs = {
  // `AppShell` 必须**渲染插槽**：三栏内容都经它的具名插槽下发，
  // 布尔桩不渲染插槽 ⇒ 子树（含侧栏）根本不挂载，也就无法派发事件。
  // 只渲染 `history`：其余两栏的插槽表达式需要更完整的 mock，与本文件用例无关。
  AppShell: { name: 'AppShell', template: '<div><slot name="history" /></div>' },
  // 侧栏用一个"点得出 create 事件"的微型桩，用于验证视图的事件接线
  HistorySidebar: {
    name: 'HistorySidebar',
    template: '<aside class="sidebar-stub"><button class="sidebar-create" @click="$emit(\'create\')" /></aside>',
  },
  ChatPanel: true,
  WorkspacePanel: true,
  ToastHost: true,
  ConfirmDialog: true,
}

/** 只造本视图会触碰的字段；其余由 `useSession()` 的消费方（子组件）负责，这里已打桩 */
function makeSession(initialThreadId: string | null, threadIds: string[]) {
  // 与真实装配同起点：装配期 ref 为 null，恢复是"事后"由 select 写入（见 useAppSession）
  const activeThreadId = ref<string | null>(null)
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
      clearActive: vi.fn(() => {
        activeThreadId.value = null
      }),
    },
    chat: { phase: ref<string>(RUN_PHASE.IDLE) },
    preview: {
      open: ref(false),
      close: vi.fn(),
      backToList: vi.fn(),
      openFile: vi.fn(),
      download: vi.fn(),
      onFileRemoved: vi.fn(),
    },
    workspace: { toggleSpace: vi.fn(), toggleDir: vi.fn(), remove: vi.fn() },
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
