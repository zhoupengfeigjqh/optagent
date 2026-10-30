/**
 * 单元测试：定时任务接口封装（015）
 *
 * 两条重点：
 * 1. **请求形状**：路径、方法、请求体字段名（含 `new_thread_per_run`）、`runs` 的查询参数——
 *    这些都是与后端 `additionalProperties: false` 的硬契约，写错只会得到 400。
 * 2. **SSE 重连有界**（宪章原则九）：1/2/4/8/16s 最多 5 次，用尽报 `degraded` 且**不再重试**；
 *    任何一次成功连上都要把退避预算还回去（否则断线多次后很快就"假死"）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpClient } from './http'
import {
  createScheduledTasksApi,
  SCHEDULE_SIGNAL_BACKOFF_MS,
  type ScheduleEventsDeps,
  type ScheduleSignalState,
} from './scheduled-tasks'

/** 可控的假 `EventSource`：记录实例并手动触发事件。 */
class FakeSource {
  readonly listeners = new Map<string, Array<() => void>>()
  closed = false
  constructor(readonly url: string) {}

  addEventListener(type: string, handler: () => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(handler)
    this.listeners.set(type, list)
  }

  close(): void {
    this.closed = true
  }

  emit(type: string): void {
    for (const handler of this.listeners.get(type) ?? []) handler()
  }
}

function apiWith(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200
  // 204 MUST NOT 带正文（`new Response('', { status: 204 })` 会直接抛 TypeError）
  const payload = status === 204 ? null : typeof body === 'string' ? body : JSON.stringify(body)
  const fetchImpl = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(payload, {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )
  const client = createHttpClient({ fetchImpl: fetchImpl as unknown as typeof fetch })
  return { api: createScheduledTasksApi(client), fetchImpl }
}

describe('请求形状', () => {
  it('list → GET /api/scheduled-tasks，原样透传派生字段', async () => {
    const { api, fetchImpl } = apiWith({ tasks: [{ task_id: 't1', status: 'idle' }] })

    const result = await api.list()

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/scheduled-tasks')
    expect(result.tasks[0]?.task_id).toBe('t1')
  })

  it('create → POST，请求体含 new_thread_per_run（复用模式必须送达）', async () => {
    const { api, fetchImpl } = apiWith({ task: { task_id: 't1' } }, { status: 201 })

    await api.create({
      name: '日报',
      prompt: '汇总进度',
      start_at: '2026-10-31T01:00:00.000Z',
      interval_seconds: 60,
      max_runs: 3,
      deadline_at: '2026-11-01T01:00:00.000Z',
      new_thread_per_run: false,
    })

    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('/api/scheduled-tasks')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      name: '日报',
      interval_seconds: 60,
      new_thread_per_run: false,
    })
  })

  it('update → PATCH /{id}（编辑体不含 new_thread_per_run），id 经过编码', async () => {
    const { api, fetchImpl } = apiWith({ task: { task_id: 'a/b' } })

    await api.update('a/b', {
      name: '改后的名字',
      prompt: '新的提示词',
      thinking: true,
      start_at: '2026-10-31T01:00:00.000Z',
      interval_seconds: 120,
      max_runs: 5,
      deadline_at: '2026-11-01T01:00:00.000Z',
    })

    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('/api/scheduled-tasks/a%2Fb')
    expect((init as RequestInit).method).toBe('PATCH')
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body).toMatchObject({ name: '改后的名字', interval_seconds: 120, max_runs: 5 })
    // 会话模式创建后不可改（FR-060）：PATCH 体 MUST 不含该键（服务端会 400）
    expect(body).not.toHaveProperty('new_thread_per_run')
  })

  it('setEnabled → PATCH /{id}/enabled，id 经过编码', async () => {
    const { api, fetchImpl } = apiWith({ task: { task_id: 'a/b' } })

    await api.setEnabled('a/b', true)

    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('/api/scheduled-tasks/a%2Fb/enabled')
    expect((init as RequestInit).method).toBe('PATCH')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ enabled: true })
  })

  it('remove → DELETE（204 不解析正文）', async () => {
    const { api, fetchImpl } = apiWith('', { status: 204 })

    await expect(api.remove('t1')).resolves.toBeUndefined()
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/scheduled-tasks/t1')
  })

  it('runs → 查询参数用 snake_case（task_id / limit）', async () => {
    const { api, fetchImpl } = apiWith({ runs: [], total: 0 })

    await api.runs({ taskId: 't1', limit: 20 })

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/scheduled-tasks/runs?task_id=t1&limit=20')
  })

  it('错误体原样抛成 ApiError（契约错误码可被上层映射）', async () => {
    const { api } = apiWith(
      { error: { code: 'SCHEDULED_TASK_NAME_CONFLICT', message: '任务名称已存在' } },
      { status: 409 },
    )

    await expect(api.create({ name: 'x' } as never)).rejects.toMatchObject({
      code: 'SCHEDULED_TASK_NAME_CONFLICT',
      status: 409,
    })
  })
})

describe('SSE 信号订阅（有界重连）', () => {
  let sources: FakeSource[]
  let states: ScheduleSignalState[]
  let signals: number
  let api: ReturnType<typeof createScheduledTasksApi>

  const deps: ScheduleEventsDeps = {
    createSource: (url) => {
      const source = new FakeSource(url)
      sources.push(source)
      return source as unknown as EventSource
    },
  }

  beforeEach(() => {
    vi.useFakeTimers()
    sources = []
    states = []
    signals = 0
    api = createScheduledTasksApi(createHttpClient({ fetchImpl: vi.fn() as never }), deps)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('收到 scheduled-task 事件即回调；退订后关闭连接', () => {
    const unsubscribe = api.subscribe({
      onSignal: () => (signals += 1),
      onStateChange: (state) => states.push(state),
    })

    expect(sources).toHaveLength(1)
    expect(sources[0]!.url).toBe('/api/scheduled-tasks/events')

    sources[0]!.emit('scheduled-task')
    expect(signals).toBe(1)

    sources[0]!.emit('open')
    expect(states).toEqual(['connected'])

    unsubscribe()
    expect(sources[0]!.closed).toBe(true)
  })

  it('断线按 1/2/4/8/16s 退避重连，用尽后报 degraded 且不再重试', async () => {
    api.subscribe({ onSignal: () => undefined, onStateChange: (state) => states.push(state) })

    for (const delay of SCHEDULE_SIGNAL_BACKOFF_MS) {
      expect(sources).toHaveLength(SCHEDULE_SIGNAL_BACKOFF_MS.indexOf(delay) + 1)
      sources[sources.length - 1]!.emit('error')
      expect(sources[sources.length - 1]!.closed).toBe(true)
      await vi.advanceTimersByTimeAsync(delay)
    }

    // 第 6 次失败：没有下一次退避了
    sources[5]!.emit('error')

    expect(sources).toHaveLength(6)
    expect(states.filter((state) => state === 'degraded')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(sources).toHaveLength(6) // 用尽后 MUST NOT 无限重试
  })

  it('成功连上即重置退避预算（断线多次也不会提前降级）', async () => {
    api.subscribe({ onSignal: () => undefined })

    // 连续三次"断开 → 重连 → 连上"
    for (let i = 0; i < 3; i += 1) {
      sources[sources.length - 1]!.emit('error')
      await vi.advanceTimersByTimeAsync(SCHEDULE_SIGNAL_BACKOFF_MS[0]!)
      sources[sources.length - 1]!.emit('open')
    }

    expect(sources).toHaveLength(4)
    // 仍有完整预算：再断 5 次才会 degraded
    for (const delay of SCHEDULE_SIGNAL_BACKOFF_MS) {
      sources[sources.length - 1]!.emit('error')
      await vi.advanceTimersByTimeAsync(delay)
    }
    sources[sources.length - 1]!.emit('error')
    expect(sources).toHaveLength(9)
  })
})
