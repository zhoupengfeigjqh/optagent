/**
 * 定时任务接口（015，`contracts/scheduled-tasks-api.md`）
 *
 * 六个 JSON 端点 + 一个 SSE 信号端点。三条口径：
 *
 * 1. **作用域由服务端决定**（当前用户 + 当前选中数字人）：本模块 MUST NOT 传 `agent_name`，
 *    否则等于让前端持有第二份"作用域"判据（宪章原则七）。
 * 2. **派生字段（`status` / `terminated` / `can_start`）直接透传**：服务端已按
 *    "次数 + 截止 + 时刻"现算，前端复算必然与后端漂移。
 * 3. **SSE 重连有界**（宪章原则九）：`EventSource` 自带的重连是**无限**的，
 *    网络长期不可用时会静默打一辈子请求、界面却永远停在旧状态。这里改成
 *    1s / 2s / 4s / 8s / 16s 最多 5 次，用尽即上报 `degraded`，由界面提示
 *    "实时更新已暂停，可手动刷新"（不自动无限重试，也不假装还连着）。
 */

import type { HttpClient } from './http'
import type {
  CreateScheduledTaskRequest,
  ScheduledTaskListResponse,
  ScheduledTaskResponse,
  ScheduleRunListResponse,
  UpdateScheduledTaskRequest,
} from './types'

/** 运行记录查询参数。 */
export interface ScheduleRunQuery {
  /** 只看某个任务 */
  taskId?: string
  /** 返回条数（服务端封顶 200） */
  limit?: number
}

/** 信号订阅的连接状态。 */
export type ScheduleSignalState = 'connected' | 'reconnecting' | 'degraded'

/** 信号订阅回调。 */
export interface ScheduleSignalHandlers {
  /** 收到一次变更信号（调用方据此重拉列表） */
  onSignal(): void
  /** 连接状态变化；缺省 = 调用方不关心（`degraded` 时界面仍需提示，见 store） */
  onStateChange?(state: ScheduleSignalState): void
}

/** 定时任务接口。 */
export interface ScheduledTasksApi {
  /** `GET /api/scheduled-tasks` → 按 `created_at` 倒序 */
  list(): Promise<ScheduledTaskListResponse>
  /** `POST /api/scheduled-tasks` → 201（**不自动启用**） */
  create(body: CreateScheduledTaskRequest): Promise<ScheduledTaskResponse>
  /** `PATCH /api/scheduled-tasks/{id}` → 200（编辑；仅停用中可改，启用中 409） */
  update(taskId: string, body: UpdateScheduledTaskRequest): Promise<ScheduledTaskResponse>
  /** `PATCH /api/scheduled-tasks/{id}/enabled`（启用时服务端把过去的时刻推进到未来） */
  setEnabled(taskId: string, enabled: boolean): Promise<ScheduledTaskResponse>
  /** `DELETE /api/scheduled-tasks/{id}` → 204（启用中返回 409，需先停用） */
  remove(taskId: string): Promise<void>
  /** `GET /api/scheduled-tasks/runs` → 倒序 + 筛选 + 封顶 */
  runs(query?: ScheduleRunQuery): Promise<ScheduleRunListResponse>
  /** SSE 端点地址（调试与测试用；订阅请走 `subscribe`） */
  eventsUrl(): string
  /** 订阅变更信号；返回退订函数（**幂等**调用无副作用） */
  subscribe(handlers: ScheduleSignalHandlers): () => void
}

/**
 * 重连退避序列（毫秒）：5 次用尽即 `degraded`。
 *
 * 与 `EventSource` 内置重连的区别：内置重连**不设上限**，且间隔由浏览器决定（通常 3s 恒定），
 * 长期断网时既无法告知用户"已停止实时更新"，也让用户无法判断"看到的列表是不是旧的"。
 */
export const SCHEDULE_SIGNAL_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const

/** 订阅实现的可注入依赖（测试替换 `EventSource` 与定时器）。 */
export interface ScheduleEventsDeps {
  createSource?: (url: string) => EventSource
  schedule?: (fn: () => void, delayMs: number) => unknown
  cancel?: (handle: unknown) => void
}

/** 创建定时任务 API。 */
export function createScheduledTasksApi(
  client: HttpClient,
  deps: ScheduleEventsDeps = {},
): ScheduledTasksApi {
  const base = (taskId: string): string =>
    `/api/scheduled-tasks/${encodeURIComponent(taskId)}`
  const url = (): string => `${client.baseUrl}/api/scheduled-tasks/events`
  const createSource =
    deps.createSource ?? ((target: string): EventSource => new EventSource(target))
  const schedule =
    deps.schedule ?? ((fn: () => void, delayMs: number): unknown => setTimeout(fn, delayMs))
  const cancel =
    deps.cancel ?? ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>))

  return {
    list: () => client.get<ScheduledTaskListResponse>('/api/scheduled-tasks'),

    create: (body) => client.post<ScheduledTaskResponse>('/api/scheduled-tasks', body),

    update: (taskId, body) =>
      client.patch<ScheduledTaskResponse>(base(taskId), body),

    setEnabled: (taskId, enabled) =>
      client.patch<ScheduledTaskResponse>(`${base(taskId)}/enabled`, { enabled }),

    remove: (taskId) => client.del<void>(base(taskId)),

    runs: (query) =>
      client.get<ScheduleRunListResponse>('/api/scheduled-tasks/runs', {
        task_id: query?.taskId,
        limit: query?.limit,
      }),

    eventsUrl: url,

    subscribe: (handlers) => {
      let source: EventSource | null = null
      let attempt = 0
      let stopped = false
      let timer: unknown = null

      const drop = (): void => {
        source?.close()
        source = null
      }

      const connect = (): void => {
        if (stopped) return
        const next = createSource(url())
        source = next
        next.addEventListener('scheduled-task', () => handlers.onSignal())
        next.addEventListener('open', () => {
          // 连上就把退避预算还回去：断线一小时的连接与刚断开的连接不该同等对待
          attempt = 0
          handlers.onStateChange?.('connected')
        })
        next.addEventListener('error', () => {
          drop()
          if (stopped) return
          const delay = SCHEDULE_SIGNAL_BACKOFF_MS[attempt]
          if (delay === undefined) {
            handlers.onStateChange?.('degraded')
            return
          }
          attempt += 1
          handlers.onStateChange?.('reconnecting')
          timer = schedule(connect, delay)
        })
      }

      connect()

      return () => {
        stopped = true
        if (timer !== null) {
          cancel(timer)
          timer = null
        }
        drop()
      }
    },
  }
}
