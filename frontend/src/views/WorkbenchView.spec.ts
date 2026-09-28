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
  AppShell: true,
  HistorySidebar: true,
  ChatPanel: true,
  WorkspacePanel: true,
  ToastHost: true,
  ConfirmDialog: true,
}

/** 只造本视图会触碰的字段；其余由 `useSession()` 的消费方（子组件）负责，这里已打桩 */
function makeSession(initialThreadId: string | null, threadIds: string[]) {
  const activeThreadId = ref<string | null>(initialThreadId)
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
