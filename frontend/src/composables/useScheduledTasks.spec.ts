/**
 * 单元测试：定时任务 store（015，T025）
 *
 * 覆盖六条产品口径：
 * 1. 打开覆盖层只拉列表，**不改任何任务状态**（FR-003 / FR-006）；
 * 2. 创建成功后插到列表首位；
 * 3. 启停 / 删除是乐观更新，失败必须回滚且提示；
 * 4. 变更信号到达 → 重拉任务列表 **且** 刷新左栏会话（新会话要立刻可见）；
 * 5. 信号降级（重连用尽）只置 `degraded`，不制造错误态；
 * 6. 加载失败置 `error`，而不是把列表清空冒充"没有任务"。
 */
import { describe, expect, it, vi } from 'vitest'

import type { ScheduledTasksApi } from '../api/scheduled-tasks'
import type { CreateScheduledTaskRequest, ScheduledTask } from '../api/types'
import { createScheduledTasksStore } from './useScheduledTasks'
import type { ToastStore } from './useToast'

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    task_id: 't1',
    name: '日报',
    prompt: '汇总进度',
    thinking: false,
    start_at: '2026-10-31T01:00:00.000Z',
    interval_seconds: 60,
    max_runs: 3,
    deadline_at: '2026-11-01T01:00:00.000Z',
    new_thread_per_run: true,
    enabled: false,
    executed_count: 0,
    status: 'idle',
    terminated: false,
    can_start: true,
    disabled_reason: null,
    next_run_at: '2026-10-31T01:00:00.000Z',
    last_run_at: null,
    agent_name: 'demo',
    created_at: '2026-10-30T00:00:00.000Z',
    updated_at: '2026-10-30T00:00:00.000Z',
    ...overrides,
  }
}

function makeStore(
  options: { tasks?: ScheduledTask[]; fail?: 'list' | 'enable' | 'remove' | 'update' } = {},
) {
  const toast = { push: vi.fn() } as unknown as ToastStore
  const signal: { onSignal?: () => void; onStateChange?: (state: string) => void } = {}
  let tasks = options.tasks ?? []
  const api = {
    list: vi.fn(async () => {
      if (options.fail === 'list') throw new Error('boom')
      return { tasks }
    }),
    create: vi.fn(async (body: CreateScheduledTaskRequest) => {
      const created = task({ task_id: 'new', name: body.name })
      tasks = [created, ...tasks]
      return { task: created }
    }),
    update: vi.fn(async (taskId: string, body: { name: string; max_runs: number }) => {
      if (options.fail === 'update') throw new Error('boom')
      return { task: task({ task_id: taskId, name: body.name, max_runs: body.max_runs }) }
    }),
    setEnabled: vi.fn(async (taskId: string, enabled: boolean) => {
      if (options.fail === 'enable') throw new Error('boom')
      return { task: task({ task_id: taskId, enabled, status: enabled ? 'running' : 'idle' }) }
    }),
    remove: vi.fn(async (taskId: string) => {
      if (options.fail === 'remove') throw new Error('boom')
      tasks = tasks.filter((item) => item.task_id !== taskId)
    }),
    runs: vi.fn(async () => ({ runs: [], total: 0 })),
    eventsUrl: () => '/api/scheduled-tasks/events',
    subscribe: vi.fn((handlers: { onSignal: () => void; onStateChange?: (s: string) => void }) => {
      signal.onSignal = handlers.onSignal
      signal.onStateChange = handlers.onStateChange
      return () => undefined
    }),
  } as unknown as ScheduledTasksApi
  const reloadThreads = vi.fn(async () => undefined)
  const store = createScheduledTasksStore({ scheduled: api, reloadThreads, toast })
  return { store, api, toast, signal, reloadThreads }
}

describe('覆盖层开合', () => {
  it('打开只拉列表；关闭不产生任何写操作（FR-003 / FR-006）', async () => {
    const { store, api } = makeStore({ tasks: [task()] })

    store.openPanel()
    await vi.waitFor(() => expect(store.loading.value).toBe(false))

    expect(store.panelOpen.value).toBe(true)
    expect(store.tasks.value).toHaveLength(1)
    store.closePanel()
    expect(store.panelOpen.value).toBe(false)

    expect(api.create).not.toHaveBeenCalled()
    expect(api.setEnabled).not.toHaveBeenCalled()
    expect(api.remove).not.toHaveBeenCalled()
  })
})

describe('创建', () => {
  it('成功后插到首位，并向服务端发送完整入参', async () => {
    const { store, api } = makeStore({ tasks: [task({ task_id: 'old' })] })
    await store.load()

    const ok = await store.create({
      name: '新任务',
      prompt: '跑一下',
      start_at: '2026-10-31T01:00:00.000Z',
      interval_seconds: 60,
      max_runs: 2,
      deadline_at: '2026-11-01T01:00:00.000Z',
      new_thread_per_run: false,
    })

    expect(ok).toBe(true)
    expect(store.tasks.value[0]?.task_id).toBe('new')
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ new_thread_per_run: false }))
  })

  it('失败：返回 false 并提示，不往列表里塞东西', async () => {
    const { store, api, toast } = makeStore()
    api.create = vi.fn(async () => {
      throw new Error('boom')
    }) as never

    const ok = await store.create({ name: 'x' } as never)

    expect(ok).toBe(false)
    expect(store.tasks.value).toHaveLength(0)
    expect(toast.push).toHaveBeenCalled()
  })
})

describe('启停', () => {
  it('乐观更新：请求未回来时开关已变；成功后以服务端返回为准', async () => {
    const { store, api } = makeStore({ tasks: [task()] })
    await store.load()

    let resolve: (value: { task: ScheduledTask }) => void = () => undefined
    api.setEnabled = vi.fn(
      () => new Promise<{ task: ScheduledTask }>((done) => (resolve = done)),
    ) as never

    const pendingCall = store.setEnabled('t1', true)
    expect(store.tasks.value[0]?.enabled).toBe(true)
    expect(store.tasks.value[0]?.status).toBe('running')
    expect(store.pendingIds.value).toContain('t1')

    resolve({ task: task({ enabled: true, status: 'running', next_run_at: '2026-11-01T00:00:00Z' }) })
    await pendingCall

    expect(store.tasks.value[0]?.next_run_at).toBe('2026-11-01T00:00:00Z')
    expect(store.pendingIds.value).not.toContain('t1')
  })

  it('失败：回滚并提示', async () => {
    const { store, toast } = makeStore({ tasks: [task()], fail: 'enable' })
    await store.load()

    const ok = await store.setEnabled('t1', true)

    expect(ok).toBe(false)
    expect(store.tasks.value[0]?.enabled).toBe(false)
    expect(toast.push).toHaveBeenCalled()
  })

  it('信号触发的列表刷新不打断在途启停：pending 必须清掉，响应也不能被丢弃', async () => {
    const { store, api, signal } = makeStore({ tasks: [task()] })
    store.start()
    await store.load()

    let resolve: (value: { task: ScheduledTask }) => void = () => undefined
    api.setEnabled = vi.fn(
      () => new Promise<{ task: ScheduledTask }>((done) => (resolve = done)),
    ) as never

    const call = store.setEnabled('t1', true)
    // 服务端先广播变更信号、后回响应（真实时序）：列表刷新与本次变更并发
    signal.onSignal?.()
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))

    resolve({ task: task({ enabled: true, status: 'running' }) })
    await call

    // 回归点：曾经按"代际"门控清除，刷新抢先一行两个按钮就永久置灰（无法停止 / 无法删除）
    expect(store.pendingIds.value).not.toContain('t1')
    expect(store.tasks.value[0]?.enabled).toBe(true)
  })
})

describe('编辑（2026-10-30 增补）', () => {
  const EDIT = {
    name: '改后的名字',
    prompt: '新的提示词',
    start_at: '2026-11-01T01:00:00.000Z',
    interval_seconds: 60,
    max_runs: 9,
    deadline_at: '2026-11-08T01:00:00.000Z',
  }

  it('成功：用服务端响应覆盖同一行，顺序不变，pending 清空', async () => {
    const { store, api } = makeStore({
      tasks: [task(), task({ task_id: 't2', name: '另一个' })],
    })
    await store.load()

    const ok = await store.update('t1', EDIT)

    expect(ok).toBe(true)
    expect(api.update).toHaveBeenCalledWith('t1', EDIT)
    expect(store.tasks.value.map((item) => item.task_id)).toEqual(['t1', 't2'])
    expect(store.tasks.value[0]?.name).toBe('改后的名字')
    expect(store.tasks.value[0]?.max_runs).toBe(9)
    expect(store.pendingIds.value).not.toContain('t1')
  })

  it('失败（如启用中 409）：原值保持、给出提示、pending 同样清空', async () => {
    const { store, toast } = makeStore({ tasks: [task({ enabled: true })], fail: 'update' })
    await store.load()

    const ok = await store.update('t1', EDIT)

    expect(ok).toBe(false)
    expect(store.tasks.value[0]?.name).toBe('日报')
    expect(toast.push).toHaveBeenCalled()
    // 回归点：失败路径也必须摘标记，否则该行三个按钮永久置灰
    expect(store.pendingIds.value).not.toContain('t1')
  })
})

describe('删除', () => {
  it('乐观移除；失败回滚', async () => {
    const { store } = makeStore({ tasks: [task()], fail: 'remove' })
    await store.load()

    const ok = await store.remove('t1')

    expect(ok).toBe(false)
    expect(store.tasks.value).toHaveLength(1)
  })

  it('成功：行立即消失', async () => {
    const { store } = makeStore({ tasks: [task()] })
    await store.load()

    await expect(store.remove('t1')).resolves.toBe(true)
    expect(store.tasks.value).toHaveLength(0)
  })
})

describe('信号订阅', () => {
  it('信号到达 → 重拉任务列表并刷新会话列表', async () => {
    const { store, api, signal, reloadThreads } = makeStore({ tasks: [task()] })
    store.start()

    signal.onSignal?.()

    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(1))
    expect(reloadThreads).toHaveBeenCalledTimes(1)
  })

  it('降级只在重连用尽时发生（短暂重连中不提示）', () => {
    const { store, signal } = makeStore()
    store.start()

    signal.onStateChange?.('reconnecting')
    expect(store.degraded.value).toBe(false)

    signal.onStateChange?.('degraded')
    expect(store.degraded.value).toBe(true)

    signal.onStateChange?.('connected')
    expect(store.degraded.value).toBe(false)
  })

  it('重复 start 不叠加订阅；stop 后可再次 start', () => {
    const { store, api } = makeStore()

    store.start()
    store.start()
    expect(api.subscribe).toHaveBeenCalledTimes(1)

    store.stop()
    store.start()
    expect(api.subscribe).toHaveBeenCalledTimes(2)
  })
})

describe('加载与切换数字人', () => {
  it('加载失败置 error（不是静默空列表）', async () => {
    const { store } = makeStore({ fail: 'list' })

    await store.load()

    expect(store.error.value).not.toBeNull()
    expect(store.loading.value).toBe(false)
  })

  it('切换数字人：清空旧条目并重拉', async () => {
    const { store, api } = makeStore({ tasks: [task()] })
    await store.load()
    expect(store.tasks.value).toHaveLength(1)

    store.onAgentSwitched()

    expect(store.tasks.value).toHaveLength(0)
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
  })
})
