
import type { HttpClient } from './http'
import type {
  CreateScheduledTaskRequest,
  ScheduledTaskListResponse,
  ScheduledTaskResponse,
  ScheduleRunListResponse,
  UpdateScheduledTaskRequest,
} from './types'

export interface ScheduleRunQuery {
  taskId?: string
  limit?: number
}

export type ScheduleSignalState = 'connected' | 'reconnecting' | 'degraded'

export interface ScheduleSignalHandlers {
  onSignal(): void
  onStateChange?(state: ScheduleSignalState): void
}

export interface ScheduledTasksApi {
  list(): Promise<ScheduledTaskListResponse>
  create(body: CreateScheduledTaskRequest): Promise<ScheduledTaskResponse>
  update(taskId: string, body: UpdateScheduledTaskRequest): Promise<ScheduledTaskResponse>
  setEnabled(taskId: string, enabled: boolean): Promise<ScheduledTaskResponse>
  remove(taskId: string): Promise<void>
  runs(query?: ScheduleRunQuery): Promise<ScheduleRunListResponse>
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

export interface ScheduleEventsDeps {
  createSource?: (url: string) => EventSource
  schedule?: (fn: () => void, delayMs: number) => unknown
  cancel?: (handle: unknown) => void
}

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
