import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import type { AgentsApi } from '../api/agents'
import type { CurrentMcpResponse, DigitalHuman, McpServiceStatus } from '../api/types'
import { RUN_PHASE, type RunPhase } from '../constants/events'
import { createAgentsStore } from './useAgents'

const AGENT_A: DigitalHuman = {
  agent_name: 'agent-a',
  description: '',
  intro: '',
  soul: '',
  skills: [],
  enabled_tools: [],
  mcp_servers: [],
} as unknown as DigitalHuman

const AGENT_B: DigitalHuman = { ...AGENT_A, agent_name: 'agent-b' }

function makeApi(overrides: Partial<Record<keyof AgentsApi, unknown>> = {}) {
  let selectedName = 'agent-a'
  const calls = {
    select: vi.fn(async (name: string) => {
      selectedName = name
      return { agent_name: name, selected: true }
    }),
    current: vi.fn(async () => ({ agent_name: selectedName })),
    detail: vi.fn(async (name: string) => (name === 'agent-b' ? AGENT_B : AGENT_A)),
    list: vi.fn(async () => [{ agent_name: 'agent-a' }, { agent_name: 'agent-b' }]),
    currentMcp: vi.fn(async () => ({ agent_name: selectedName, mcp_servers: [] })),
    warmMcp: vi.fn(async () => ({ agent_name: selectedName, mcp_servers: [] })),
    subscribeMcp: vi.fn(() => () => undefined),
  }
  const api = { ...calls, ...overrides } as unknown as AgentsApi
  return { api, calls }
}

function makeStore(api: AgentsApi, options: { phase?: RunPhase } = {}) {
  const phase = ref<RunPhase>(options.phase ?? RUN_PHASE.IDLE)
  const toast = { push: vi.fn() }
  const onSwitched = vi.fn(async () => undefined)
  const store = createAgentsStore({
    agents: api,
    getPhase: () => phase.value,
    toast: toast as unknown as Parameters<typeof createAgentsStore>[0]['toast'],
    onSwitched,
  })
  return { store, phase, toast, onSwitched }
}

describe('switchingDisabled —— 仅回答进行中禁用（FR-015 / V-14）', () => {
  it('空闲 → 可切换，原因为 null', () => {
    const { api } = makeApi()
    const { store } = makeStore(api)

    expect(store.switchingDisabled.value).toBe(false)
    expect(store.switchingDisabledReason.value).toBeNull()
  })

  it('一轮回答进行中 → 禁用，原因指向"等一等"', () => {
    const { api } = makeApi()
    const { store } = makeStore(api, { phase: RUN_PHASE.STREAMING })

    expect(store.switchingDisabled.value).toBe(true)
    expect(store.switchingDisabledReason.value).toContain('回答进行中')
  })

  it('对话结束（completed / failed / aborted）→ 可切换，与是否已有消息无关', () => {
    const { api } = makeApi()
    for (const phase of [RUN_PHASE.COMPLETED, RUN_PHASE.FAILED, RUN_PHASE.ABORTED]) {
      const { store } = makeStore(api, { phase })
      expect(store.switchingDisabled.value).toBe(false)
      expect(store.switchingDisabledReason.value).toBeNull()
    }
  })
})

describe('switchTo —— 禁用即不发请求（V-14 兜底）', () => {
  it('回答进行中：不调 select、不提示、不动状态', async () => {
    const { api, calls } = makeApi()
    const { store, toast } = makeStore(api, { phase: RUN_PHASE.STREAMING })

    await store.switchTo('agent-b')

    expect(calls.select).not.toHaveBeenCalled()
    expect(toast.push).not.toHaveBeenCalled()
    expect(store.switching.value).toBe(false)
  })

  it('可切换时：走单次覆盖式 select，成功后提示"已开启新对话"并触发 onSwitched', async () => {
    const { api, calls } = makeApi()
    const { store, toast, onSwitched } = makeStore(api)

    await store.switchTo('agent-b')

    expect(calls.select).toHaveBeenCalledWith('agent-b')
    expect(store.currentAgent.value?.agent_name).toBe('agent-b')
    expect(String(toast.push.mock.calls[0]?.[1])).toContain('已开启新对话')
    expect(onSwitched).toHaveBeenCalledTimes(1)
  })

  it('切到当前已是的那一个：直接返回（不发请求、不刷新）', async () => {
    const { api, calls } = makeApi()
    const { store } = makeStore(api)
    await store.loadCurrent()
    expect(store.currentAgent.value?.agent_name).toBe('agent-a')
    calls.select.mockClear()

    await store.switchTo('agent-a')

    expect(calls.select).not.toHaveBeenCalled()
  })
})

describe('switchTo —— 失败不静默（FR-032：陈旧选中态不自动清空）', () => {
  it('后端 409 AGENT_NOT_AVAILABLE → toast 可读文案，currentAgent 保持不变', async () => {
    const failing = vi.fn(async () => {
      const err = new Error('该数字人已不可用') as Error & { code?: string }
      err.code = 'AGENT_NOT_AVAILABLE'
      throw err
    })
    const { api } = makeApi({ select: failing })
    const { store, toast, onSwitched } = makeStore(api)
    await store.loadCurrent()
    const before = store.currentAgent.value

    await store.switchTo('agent-b')

    expect(failing).toHaveBeenCalledWith('agent-b')
    expect(toast.push).toHaveBeenCalledTimes(1)
    expect(String(toast.push.mock.calls[0]?.[1])).toContain('不可用')
    expect(store.currentAgent.value).toBe(before)
    expect(onSwitched).not.toHaveBeenCalled()
    expect(store.switching.value).toBe(false)
  })

  it('后端 404（数字人已被移除）→ 同样提示且不改状态', async () => {
    const failing = vi.fn(async () => {
      const err = new Error('数字人不存在') as Error & { code?: string }
      err.code = 'AGENT_NOT_FOUND'
      throw err
    })
    const { api } = makeApi({ select: failing })
    const { store, toast } = makeStore(api)
    await store.loadCurrent()
    const before = store.currentAgent.value

    await store.switchTo('agent-b')

    expect(toast.push).toHaveBeenCalledTimes(1)
    expect(store.currentAgent.value).toBe(before)
  })
})

const mcp = (status: McpServiceStatus['status']): McpServiceStatus[] => [
  { name: 'svc', transport: 'streamable-http', status },
]

describe('MCP 状态归属与发送前等待（2026-10-18）', () => {
  it('加载当前数字人即预热：不再等"发一轮对话"才建连', async () => {
    const { api, calls } = makeApi()
    const { store } = makeStore(api)

    await store.loadCurrent()

    expect(calls.warmMcp).toHaveBeenCalledTimes(1)
  })

  it('mcpPending：任一服务为 unknown 即为真（有灰 = 尚无连接结果）', async () => {
    const unknown = { agent_name: 'agent-a', mcp_servers: mcp('unknown') }
    const { api } = makeApi({
      currentMcp: vi.fn(async () => unknown),
      warmMcp: vi.fn(async () => unknown),
    })
    const { store } = makeStore(api)
    await store.loadCurrent()

    expect(store.mcpPending.value).toBe(true)
  })

  it('别的数字人的快照一律丢弃（否则旧人的绿会让发送前等待误放行）', async () => {
    const pushes: Array<(snapshot: CurrentMcpResponse) => void> = []
    const { api } = makeApi({
      subscribeMcp: vi.fn((cb: (snapshot: CurrentMcpResponse) => void) => {
        pushes.push(cb)
        return () => undefined
      }),
    })
    const { store } = makeStore(api)
    await store.loadCurrent()
    store.startMcpSubscription()

    pushes.at(0)?.({ agent_name: 'agent-b', mcp_servers: mcp('connected') })
    expect(store.mcpServers.value).toEqual([])

    pushes.at(0)?.({ agent_name: 'agent-a', mcp_servers: mcp('failed') })
    expect(store.mcpServers.value[0]?.status).toBe('failed')
    store.stopMcpSubscription()
  })

  it('切换后只采用新数字人的结果：旧结果既不残留也不冒充新结果', async () => {
    const stale = { agent_name: 'agent-a', mcp_servers: mcp('connected') }
    const { api } = makeApi({
      currentMcp: vi.fn(async () => stale),
      warmMcp: vi.fn(async () => stale),
    })
    const { store } = makeStore(api)
    await store.loadCurrent()
    expect(store.mcpServers.value).toHaveLength(1)

    await store.switchTo('agent-b')

    expect(store.mcpServers.value).toEqual([])
  })

  it('ensureMcpReady：灰色 → 轮询取到结果即放行', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const { api } = makeApi({
        currentMcp: vi.fn(async () => {
          calls += 1
          return {
            agent_name: 'agent-a',
            mcp_servers: mcp(calls >= 2 ? 'connected' : 'unknown'),
          }
        }),
        warmMcp: vi.fn(async () => ({ agent_name: 'agent-a', mcp_servers: mcp('unknown') })),
      })
      const { store } = makeStore(api)
      await store.loadCurrent()
      expect(store.mcpPending.value).toBe(true)

      const running = store.ensureMcpReady(10_000)
      // 兜底轮询间隔 2s（2026-11-07）：推进略多于一个间隔即取到结果
      await vi.advanceTimersByTimeAsync(2_100)

      await expect(running).resolves.toBe(true)
      expect(store.mcpPending.value).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ensureMcpReady：始终无色 → 到点返回 false（调用方降级放行，不无限等）', async () => {
    vi.useFakeTimers()
    try {
      const unknown = { agent_name: 'agent-a', mcp_servers: mcp('unknown') }
      const { api } = makeApi({
        currentMcp: vi.fn(async () => unknown),
        warmMcp: vi.fn(async () => unknown),
      })
      const { store } = makeStore(api)
      await store.loadCurrent()

      const running = store.ensureMcpReady(1_000)
      await vi.advanceTimersByTimeAsync(2_200)

      await expect(running).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('loadCandidates —— 清单只含可用数字人（FR-030）', () => {
  it('详情取不到（配置损坏/已移除）的候选项被剔除，不影响其余项', async () => {
    const { api } = makeApi({
      list: vi.fn(async () => [{ agent_name: 'agent-a' }, { agent_name: 'ghost' }]),
      detail: vi.fn(async (name: string) => {
        if (name === 'ghost') {
          const err = new Error('数字人不存在或配置损坏') as Error & { code?: string }
          err.code = 'AGENT_NOT_FOUND'
          throw err
        }
        return AGENT_A
      }),
    })
    const { store } = makeStore(api)

    await store.loadCandidates()

    expect(store.candidates.value.map((item) => item.agent_name)).toEqual(['agent-a'])
  })
})
