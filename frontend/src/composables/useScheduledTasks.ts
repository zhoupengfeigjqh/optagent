
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { ScheduleRunQuery, ScheduledTasksApi } from '../api/scheduled-tasks'
import type {
  CreateScheduledTaskRequest,
  ErrorInfo,
  ScheduledTask,
  ScheduleRun,
  UpdateScheduledTaskRequest,
} from '../api/types'
import { toErrorInfo, toUserMessage } from '../utils/error-message'
import { useSession } from './useAppSession'
import type { ToastStore } from './useToast'

export interface ScheduledTasksDeps {
  scheduled: ScheduledTasksApi
  reloadThreads?: () => Promise<void> | void
  toast?: ToastStore
}

export interface ScheduledTasksStore {
  readonly tasks: Readonly<Ref<ScheduledTask[]>>
  readonly loading: Readonly<Ref<boolean>>
  readonly error: Readonly<Ref<ErrorInfo | null>>
  readonly panelOpen: Readonly<Ref<boolean>>
  readonly creating: Readonly<Ref<boolean>>
  readonly pendingIds: ComputedRef<readonly string[]>
  /** 实时更新已降级（SSE 重连用尽）：界面提示"可手动刷新" */
  readonly degraded: Readonly<Ref<boolean>>
  readonly runs: Readonly<Ref<ScheduleRun[]>>
  readonly runsTotal: Readonly<Ref<number>>
  readonly runsLoading: Readonly<Ref<boolean>>
  readonly runsError: Readonly<Ref<ErrorInfo | null>>
  openPanel(): void
  closePanel(): void
  load(): Promise<void>
  create(input: CreateScheduledTaskRequest): Promise<boolean>
  update(taskId: string, input: UpdateScheduledTaskRequest): Promise<boolean>
  setEnabled(taskId: string, enabled: boolean): Promise<boolean>
  remove(taskId: string): Promise<boolean>
  loadRuns(query?: ScheduleRunQuery): Promise<void>
  /** 开始订阅变更信号（幂等） */
  start(): void
  stop(): void
  onAgentSwitched(): void
}

export function createScheduledTasksStore(deps: ScheduledTasksDeps): ScheduledTasksStore {
  const tasks = ref<ScheduledTask[]>([])
  const loading = ref(false)
  const error = ref<ErrorInfo | null>(null)
  const panelOpen = ref(false)
  const creating = ref(false)
  const pending = ref<string[]>([])
  const degraded = ref(false)
  const runs = ref<ScheduleRun[]>([])
  const runsTotal = ref(0)
  const runsLoading = ref(false)
  const runsError = ref<ErrorInfo | null>(null)

  const pendingIds = computed(() => pending.value)

  let generation = 0
  /**
   * 列表请求序号：**只**用来丢弃过期的列表响应。
   *
   * MUST NOT 与 `generation` 合用一个计数器：变更信号（SSE）随时触发 `load()`，
   * 若它也推进"域代际"，用户刚点的启停/删除请求返回时就会被当成过期响应丢弃——
   * `pendingIds` 再也清不掉，该行两个按钮从此永久置灰（2026-10-30 回归修复）。
   */
  let loadSeq = 0
  /** 信号订阅的退订函数；`null` = 未订阅（`start()` 的幂等判据） */
  let unsubscribe: (() => void) | null = null

  function markPending(taskId: string, busy: boolean): void {
    pending.value = busy
      ? [...pending.value.filter((id) => id !== taskId), taskId]
      : pending.value.filter((id) => id !== taskId)
  }

  function replaceTask(next: ScheduledTask): void {
    tasks.value = tasks.value.map((task) => (task.task_id === next.task_id ? next : task))
  }

  async function load(): Promise<void> {
    const token = generation
    const seq = ++loadSeq
    loading.value = true
    error.value = null
    try {
      const response = await deps.scheduled.list()
      if (token !== generation || seq !== loadSeq) return
      tasks.value = response.tasks
    } catch (cause) {
      if (token !== generation || seq !== loadSeq) return
      error.value = toErrorInfo(cause)
    } finally {
      if (token === generation && seq === loadSeq) loading.value = false
    }
  }

  function openPanel(): void {
    panelOpen.value = true
    void load()
  }

  function closePanel(): void {
    panelOpen.value = false
  }

  async function create(input: CreateScheduledTaskRequest): Promise<boolean> {
    if (creating.value) return false
    const token = generation
    creating.value = true
    try {
      const { task } = await deps.scheduled.create(input)
      if (token === generation) {
        tasks.value = [task, ...tasks.value.filter((item) => item.task_id !== task.task_id)]
      }
      return true
    } catch (cause) {
      deps.toast?.push('error', toUserMessage(toErrorInfo(cause)))
      return false
    } finally {
      creating.value = false
    }
  }

  async function update(taskId: string, input: UpdateScheduledTaskRequest): Promise<boolean> {
    const token = generation
    markPending(taskId, true)
    try {
      const { task } = await deps.scheduled.update(taskId, input)
      if (token === generation) replaceTask(task)
      return true
    } catch (cause) {
      if (token === generation) {
        deps.toast?.push('error', toUserMessage(toErrorInfo(cause)))
      }
      return false
    } finally {
      // 同启停 / 删除：请求一结束就摘标记，否则该行按钮永久置灰
      markPending(taskId, false)
    }
  }

  async function setEnabled(taskId: string, enabled: boolean): Promise<boolean> {
    const before = tasks.value
    const target = before.find((task) => task.task_id === taskId)
    if (!target) return false
    const token = generation
    markPending(taskId, true)
    tasks.value = before.map((task) =>
      task.task_id === taskId ? { ...task, enabled, status: enabled ? 'running' : 'idle' } : task,
    )
    try {
      const { task } = await deps.scheduled.setEnabled(taskId, enabled)
      if (token !== generation) return true
      replaceTask(task)
      return true
    } catch (cause) {
      if (token !== generation) return false
      tasks.value = before
      deps.toast?.push('error', toUserMessage(toErrorInfo(cause)))
      return false
    } finally {
      // 无条件清除：`pendingIds` 是"这一行还有请求在途"的标记，只要请求结束就必须摘掉。
      markPending(taskId, false)
    }
  }

  /** 删除（乐观移除 + 失败回滚）；启用中的任务服务端回 409，由统一错误文案提示"请先停止任务" */
  async function remove(taskId: string): Promise<boolean> {
    const before = tasks.value
    const token = generation
    markPending(taskId, true)
    tasks.value = before.filter((task) => task.task_id !== taskId)
    try {
      await deps.scheduled.remove(taskId)
      return true
    } catch (cause) {
      if (token !== generation) return false
      tasks.value = before
      deps.toast?.push('error', toUserMessage(toErrorInfo(cause)))
      return false
    } finally {
      // 同 `setEnabled`：请求一结束就摘标记，否则该行按钮永久置灰
      markPending(taskId, false)
    }
  }

  async function loadRuns(query: ScheduleRunQuery = {}): Promise<void> {
    const token = generation
    runsLoading.value = true
    runsError.value = null
    try {
      const response = await deps.scheduled.runs(query)
      if (token !== generation) return
      runs.value = response.runs
      runsTotal.value = response.total
    } catch (cause) {
      if (token !== generation) return
      runsError.value = toErrorInfo(cause)
      runs.value = []
      runsTotal.value = 0
    } finally {
      if (token === generation) runsLoading.value = false
    }
  }

  function start(): void {
    if (unsubscribe !== null) return
    unsubscribe = deps.scheduled.subscribe({
      onSignal: () => {
        void load()
        void deps.reloadThreads?.()
      },
      onStateChange: (state) => {
        // 只有"用尽重连"才是降级；短暂重连中不打扰用户
        degraded.value = state === 'degraded'
      },
    })
  }

  function stop(): void {
    unsubscribe?.()
    unsubscribe = null
  }

  function onAgentSwitched(): void {
    generation++
    tasks.value = []
    runs.value = []
    runsTotal.value = 0
    runsError.value = null
    error.value = null
    loading.value = false
    pending.value = []
    void load()
  }

  return {
    tasks,
    loading,
    error,
    panelOpen,
    creating,
    pendingIds,
    degraded,
    runs,
    runsTotal,
    runsLoading,
    runsError,
    openPanel,
    closePanel,
    load,
    create,
    update,
    setEnabled,
    remove,
    loadRuns,
    start,
    stop,
    onAgentSwitched,
  }
}

export function useScheduledTasks(): ScheduledTasksStore {
  return useSession().schedule
}
