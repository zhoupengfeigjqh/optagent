import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAgentsApi, type AgentsApi } from '../api/agents'
import { createHttpClient } from '../api/http'
import type { CurrentMcpResponse, DigitalHuman } from '../api/types'
import type { RunPhase } from '../constants/events'
import { createFetchRouter, errorResponse, jsonResponse } from '../../tests/helpers'
import { createAgentsStore } from './useAgents'
import { createToastStore } from './useToast'

const OPS: DigitalHuman = {
  agent_name: 'ops',
  soul: '你是排产助手',
  skills: [{ name: '排产', description: '生成排产方案' }],
  enabled_tools: ['read_file'],
  mcp_servers: [{ name: 'solver', transport: 'stdio' }],
}

function baseRoutes() {
  return {
    'GET /api/agents': () =>
      jsonResponse([
        { agent_name: 'ops', description: '排产' },
        { agent_name: 'analyst', description: '分析' },
      ]),
    'GET /api/agents/ops': () => jsonResponse(OPS),
    'GET /api/agents/analyst': () => jsonResponse({ ...OPS, agent_name: 'analyst' }),
    'GET /api/agents/current': () => jsonResponse({ agent_name: 'ops' }),
    'GET /api/agents/current/mcp': () =>
      jsonResponse({
        agent_name: 'ops',
        mcp_servers: [{ name: 'solver', transport: 'stdio', status: 'connected' }],
      }),
    'POST /api/agents/current/exit': () => jsonResponse({ exited: true }),
    'POST /api/agents/ops/select': () => jsonResponse({ agent_name: 'ops', selected: true }),
    'POST /api/agents/analyst/select': () =>
      jsonResponse({ agent_name: 'analyst', selected: true }),
  }
}

function makeStore(
  routes: Parameters<typeof createFetchRouter>[0],
  phase = ref<RunPhase>('idle'),
) {
  const router = createFetchRouter(routes)
  const agentsApi = createAgentsApi(createHttpClient({ baseUrl: '', fetchImpl: router.fetch }))
  const toast = createToastStore()
  const store = createAgentsStore({
    agents: agentsApi,
    getPhase: () => phase.value,
    toast,
  })
  return { store, router, phase, toast }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useAgents - 当前数字人（FR-032、FR-033）', () => {
  it('未选定时为空状态且不请求详情', async () => {
    const { store, router } = makeStore({
      'GET /api/agents/current': () => jsonResponse({ agent_name: null }),
    })

    await store.loadCurrent()

    expect(store.currentAgent.value).toBeNull()
    expect(store.mcpServers.value).toEqual([])
    expect(router.calls).toHaveLength(1)
  })

  it('已选定时加载详情与 MCP 状态', async () => {
    const { store } = makeStore(baseRoutes())

    await store.loadCurrent()

    expect(store.currentAgent.value?.agent_name).toBe('ops')
    expect(store.currentAgent.value?.soul).toBe('你是排产助手')
    expect(store.mcpServers.value).toEqual([
      { name: 'solver', transport: 'stdio', status: 'connected' },
    ])
  })

  it('MCP 服务返回 failed 属正常状态，不视为异常（FR-034）', async () => {
    const { store } = makeStore({
      ...baseRoutes(),
      'GET /api/agents/current/mcp': () =>
        jsonResponse({
          agent_name: 'ops',
          mcp_servers: [{ name: 'solver', transport: 'stdio', status: 'failed' }],
        }),
    })

    await store.loadCurrent()

    expect(store.mcpServers.value[0].status).toBe('failed')
    expect(store.error.value).toBeNull()
  })

  it('数字人不存在时记录错误并清空当前数字人', async () => {
    const { store } = makeStore({
      ...baseRoutes(),
      'GET /api/agents/ops': () => errorResponse('AGENT_NOT_FOUND', 'x', 404),
    })

    await store.loadCurrent()

    expect(store.error.value?.code).toBe('AGENT_NOT_FOUND')
    expect(store.currentAgent.value).toBeNull()
  })

  it('loadCandidates 聚合数字人详情', async () => {
    const { store } = makeStore(baseRoutes())

    await store.loadCandidates()

    expect(store.candidates.value.map((item) => item.agent_name)).toEqual(['ops', 'analyst'])
  })

  it('loadCandidates 单个详情失败时跳过该项', async () => {
    const { store } = makeStore({
      ...baseRoutes(),
      'GET /api/agents/analyst': () => errorResponse('AGENT_NOT_FOUND', 'x', 404),
    })

    await store.loadCandidates()

    expect(store.candidates.value.map((item) => item.agent_name)).toEqual(['ops'])
  })
})

describe('useAgents - 切换（FR-035~FR-037、V-14）', () => {
  it('切换为单次覆盖式 select，不先 exit（FR-037 修订）', async () => {
    // 有状态桩：select 成功后后端当前数字人随之改变，loadCurrent 应读回新值
    let selected = 'ops'
    const { store, router } = makeStore({
      ...baseRoutes(),
      'GET /api/agents/current': () => jsonResponse({ agent_name: selected }),
      'POST /api/agents/analyst/select': () => {
        selected = 'analyst'
        return jsonResponse({ agent_name: 'analyst', selected: true })
      },
    })
    await store.loadCurrent()

    await store.switchTo('analyst')

    const posts = router.calls.filter((call) => call.method === 'POST').map((call) => call.path)
    // 覆盖式选中：只有一次 select，不再有 exit
    expect(posts).toEqual(['/api/agents/analyst/select'])
    expect(store.currentAgent.value?.agent_name).toBe('analyst')
  })

  it('切换成功后提示下一轮生效', async () => {
    const { store, toast } = makeStore(baseRoutes())
    await store.loadCurrent()

    await store.switchTo('analyst')

    expect(toast.items.value[0]?.text).toContain('下一轮对话生效')
  })

  it('会话进行中禁止切换：不发任何请求（V-14、FR-036）', async () => {
    const phase = ref<RunPhase>('streaming')
    const { store, router } = makeStore(baseRoutes(), phase)
    await store.loadCurrent()
    const before = router.calls.length

    expect(store.switchingDisabled.value).toBe(true)
    await store.switchTo('analyst')

    expect(router.calls).toHaveLength(before)
    expect(store.currentAgent.value?.agent_name).toBe('ops')
  })

  it('切换到当前数字人为无操作', async () => {
    const { store, router } = makeStore(baseRoutes())
    await store.loadCurrent()
    const before = router.calls.length

    await store.switchTo('ops')

    expect(router.calls).toHaveLength(before)
  })

  it('切换失败时提示且不改变当前数字人', async () => {
    const { store, toast } = makeStore({
      ...baseRoutes(),
      'POST /api/agents/analyst/select': () => errorResponse('AGENT_NOT_FOUND', 'x', 404),
    })
    await store.loadCurrent()

    await store.switchTo('analyst')

    expect(store.currentAgent.value?.agent_name).toBe('ops')
    expect(toast.items.value[0]?.text).toBe('数字人不存在或配置异常')
  })

  it('切换成功后可触发回调刷新会话列表', async () => {
    const router = createFetchRouter(baseRoutes())
    const agentsApi = createAgentsApi(createHttpClient({ baseUrl: '', fetchImpl: router.fetch }))
    const onSwitched = vi.fn(async () => undefined)
    const store = createAgentsStore({
      agents: agentsApi,
      getPhase: () => 'idle',
      onSwitched,
    })
    await store.loadCurrent()

    await store.switchTo('analyst')

    expect(onSwitched).toHaveBeenCalledTimes(1)
  })
})

describe('useAgents - MCP 状态订阅（SSE 推送，替代轮询）', () => {
  /** 捕获 subscribeMcp 回调的假 API，其余方法走 fetch 桩 */
  function makeSubscribableStore(routes: Parameters<typeof createFetchRouter>[0]) {
    const router = createFetchRouter(routes)
    const real = createAgentsApi(createHttpClient({ baseUrl: '', fetchImpl: router.fetch }))
    let onSnapshot: ((data: CurrentMcpResponse) => void) | null = null
    const close = vi.fn()
    const agentsApi: AgentsApi = {
      ...real,
      subscribeMcp: (cb) => {
        onSnapshot = cb
        return close
      },
    }
    const store = createAgentsStore({ agents: agentsApi, getPhase: () => 'idle' })
    return {
      store,
      close,
      emit: (data: CurrentMcpResponse) => onSnapshot?.(data),
      subscribed: () => onSnapshot !== null,
    }
  }

  it('订阅后收到推送快照即更新 MCP 状态', async () => {
    const { store, emit, subscribed } = makeSubscribableStore(baseRoutes())
    await store.loadCurrent()

    store.startMcpSubscription()
    expect(subscribed()).toBe(true)

    emit({
      agent_name: 'ops',
      mcp_servers: [{ name: 'solver', transport: 'stdio', status: 'failed' }],
    })
    expect(store.mcpServers.value).toEqual([
      { name: 'solver', transport: 'stdio', status: 'failed' },
    ])

    store.stopMcpSubscription()
  })

  it('stopMcpSubscription 关闭订阅且幂等', () => {
    const { store, close } = makeSubscribableStore(baseRoutes())

    store.startMcpSubscription()
    store.stopMcpSubscription()
    store.stopMcpSubscription()

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('重复 start 不会叠加订阅', () => {
    const { store, close } = makeSubscribableStore(baseRoutes())

    store.startMcpSubscription()
    store.startMcpSubscription()
    store.stopMcpSubscription()

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('MCP 刷新失败不影响主流程（不抛错、不弹提示）', async () => {
    const { store, toast } = makeStore({
      'GET /api/agents/current/mcp': () => errorResponse('INTERNAL_ERROR', 'x', 500),
    })

    await expect(store.refreshMcp()).resolves.toBeUndefined()
    expect(toast.items.value).toHaveLength(0)
  })
})
