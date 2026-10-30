/**
 * 定时任务状态（015）
 *
 * 一个 store 服务"设置页覆盖层"的全部交互：列表、创建、启停、删除、运行记录、信号订阅。
 *
 * 四条口径（改动前请先读一遍，都是踩过的）：
 *
 * 1. **开合覆盖层不写任何任务状态**（`FR-003`/`FR-006`）：`openPanel()` 只置标志位并拉列表，
 *    MUST NOT 调 `create` / `setEnabled`——否则"看一眼设置"就成了副作用。
 * 2. **启停 / 删除是乐观更新**：开关与行移除先本地生效，请求失败整体回滚并提示。
 *    这两个动作都是"终态式"的（服务端不会部分成功），所以本地先行是安全的。
 * 3. **派生字段以服务端为准**：乐观更新时只做最小猜测（`status`），成功后一律用响应里的
 *    `task` 覆盖回本地——次数、`next_run_at`、`terminated` 都不在前端复算。
 * 4. **切换数字人必须重拉**（`onAgentSwitched`）：任务属于数字人数据域，旧条目一律不成立；
 *    `generation` 让切人瞬间在途的旧响应失效，避免旧列表覆盖新列表。
 */

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

/** 构造参数。 */
export interface ScheduledTasksDeps {
  scheduled: ScheduledTasksApi
  /**
   * 收到信号后同步刷新左栏会话列表：定时任务会在后台新建会话，
   * 不刷新的话用户要等下次手动操作才看得见"又跑了一轮"。
   */
  reloadThreads?: () => Promise<void> | void
  toast?: ToastStore
}

/** 定时任务 store。 */
export interface ScheduledTasksStore {
  readonly tasks: Readonly<Ref<ScheduledTask[]>>
  readonly loading: Readonly<Ref<boolean>>
  readonly error: Readonly<Ref<ErrorInfo | null>>
  /** 覆盖层是否展开（纯视图态，不落盘） */
  readonly panelOpen: Readonly<Ref<boolean>>
  /** 创建提交中（防重复提交） */
  readonly creating: Readonly<Ref<boolean>>
  /** 已有请求在途的任务 id（行内启停/删除按钮据此置灰） */
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
  /** 编辑（2026-10-30 增补）：服务端整份替换，成功用响应覆盖本地同一行 */
  update(taskId: string, input: UpdateScheduledTaskRequest): Promise<boolean>
  setEnabled(taskId: string, enabled: boolean): Promise<boolean>
  remove(taskId: string): Promise<boolean>
  loadRuns(query?: ScheduleRunQuery): Promise<void>
  /** 开始订阅变更信号（幂等） */
  start(): void
  /** 停止订阅（关闭覆盖层/切换数字人时调用） */
  stop(): void
  /** 切换数字人后：清空本地并重拉（在 `useAppSession` 的 `onSwitched` 里调用） */
  onAgentSwitched(): void
}

/** 创建定时任务 store。 */
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

  /** 域代际：切换数字人时自增，在途响应（列表与变更）一律丢弃 */
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

  /** 用服务端返回的最新任务覆盖本地同 id 项（乐观更新的收敛点） */
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
      // 加载失败置错误态，**不是**空列表：空列表会让用户以为任务都没了
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
      // 切换数字人后回来的旧响应：不往新列表里塞别人家的任务
      if (token === generation) {
        // 新建的排最前：列表按 `created_at` 倒序，刚配好的那条就是用户要找的
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

  /**
   * 编辑（2026-10-30 增补，`FR-065`~`FR-069`）。
   *
   * **不做乐观更新**：可编辑字段里有开始时刻、次数上限与截止时间，改任何一项都会让
   * `terminated` / `can_start` / `next_run_at` 这些派生字段重新计算——前端复算等于实现
   * 第二套调度器（宪章原则二/七）。这里只把该行标为"请求在途"，成功后用响应覆盖。
   *
   * 启用中服务端一律 409（`SCHEDULED_TASK_ENABLED`）：界面上该按钮本就置灰，
   * 这里再兜一层，避免并发下把一条正在跑的任务改成另一份配置。
   */
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

  /**
   * 启停（乐观更新）。
   *
   * 乐观期间只改 `enabled` 与 `status` 两件事：前者是用户点的那一下，后者是它的直接观感。
   * 其余派生字段（`terminated` / `can_start` / `next_run_at`）一律等服务端响应——
   * 前端算 `next_run_at` 就等于实现了第二套调度器（宪章原则二）。
   */
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
      // 曾经按代际门控，导致被信号刷新抢先时永久置灰（2026-10-30 回归修复）。
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
      // 信号只是加速器：丢了也不影响正确性（下次打开面板会主动拉）
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
    // 自增即作废旧代际：在途请求返回后一律丢弃
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

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useScheduledTasks(): ScheduledTasksStore {
  return useSession().schedule
}
