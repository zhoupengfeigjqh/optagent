/**
 * US6 集成验收：数字人信息与切换
 *
 * 覆盖 quickstart 的 US6 独立测试路径：
 * 打开聊天区 → 名称与 MCP 状态展示 → 切换（**单次覆盖式 select**，FR-037 修订）→ 下一轮生效；
 * 以及 V-14：会话进行中切换入口置灰且**不发切换请求**。
 */

import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Ref } from 'vue'

import type { DigitalHuman } from '../../src/api/types'
import ChatPanel from '../../src/components/chat/ChatPanel.vue'
import {
  createFetchRouter,
  jsonResponse,
  memoryStorage,
  mountInSession,
  waitFor,
  type FetchRouter,
} from '../helpers'

function detail(name: string): DigitalHuman {
  return {
    agent_name: name,
    soul: `我是 ${name}`,
    skills: [{ name: '排产', description: '生成排产方案' }],
    enabled_tools: ['read_file'],
    mcp_servers: [{ name: 'filesystem', transport: 'stdio' }],
  }
}

/** 有状态桩：`select` 后 `current` 随之改变 */
function createRouter(): FetchRouter {
  let current: string | null = 'ops'

  return createFetchRouter({
    'GET /api/agents/current': () => jsonResponse({ agent_name: current }),
    'GET /api/agents/current/mcp': () =>
      jsonResponse({ mcp_servers: [{ name: 'filesystem', transport: 'stdio', status: 'connected' }] }),
    'GET /api/agents': () =>
      jsonResponse([
        { agent_name: 'ops', description: '排产' },
        { agent_name: 'analyst', description: '分析' },
      ]),
    'GET /api/agents/ops': () => jsonResponse(detail('ops')),
    'GET /api/agents/analyst': () => jsonResponse(detail('analyst')),
    'POST /api/agents/analyst/select': () => {
      current = 'analyst'
      return jsonResponse({ agent_name: 'analyst', selected: true })
    },
    'GET /api/models': () => jsonResponse({ models: [{ model: 'qwen-max', is_default: true }] }),
    'GET /api/threads': () => jsonResponse([]),
  })
}

function mountChat(router: FetchRouter): {
  wrapper: VueWrapper
  session: ReturnType<typeof mountInSession>['session']
} {
  return mountInSession(ChatPanel, {
    props: { expanded: true },
    sessionOptions: { fetchImpl: router.fetch, storage: memoryStorage() },
  })
}

function switchCalls(router: FetchRouter): string[] {
  return router.calls
    .filter((call) => call.method === 'POST' && call.path.startsWith('/api/agents'))
    .map((call) => call.path)
}

describe('US6 集成：数字人信息与切换', () => {
  it('头部展示名称与 MCP 状态；切换严格按 exit → select 并更新头部', async () => {
    const router = createRouter()
    const { wrapper, session } = mountChat(router)

    // 头部：名称 + MCP 双通道状态
    await waitFor(() => session.agents.currentAgent.value !== null, '当前数字人未加载')
    await waitFor(
      () => wrapper.find('.mcp-status-item__status').exists(),
      'MCP 状态未展示',
    )
    expect(wrapper.find('.agent-summary__name').text()).toBe('ops')
    expect(wrapper.find('.mcp-status-item__status').text()).toBe('连接正常')

    // 打开数字人面板（首次打开才拉取候选列表）
    const agentButton = wrapper.findAll('.chat-header__action')[2]
    expect(agentButton.attributes('aria-pressed')).toBe('false')

    await agentButton.trigger('click')
    await waitFor(() => router.countOf('GET', '/api/agents') === 1, '候选列表未拉取')
    await waitFor(() => session.agents.candidates.value.length === 2, '候选详情未就绪')
    expect(agentButton.attributes('aria-pressed')).toBe('true')

    const candidates = wrapper.findAll('.agent-panel__candidate')
    expect(candidates.map((item) => item.find('.agent-panel__candidate-name').text())).toEqual([
      'ops',
      'analyst',
    ])

    // 切换：单次覆盖式 select（无需先 exit，FR-037 修订）
    await candidates[1].find('.base-button').trigger('click')
    await waitFor(() => session.agents.currentAgent.value?.agent_name === 'analyst', '未切到 analyst')

    expect(switchCalls(router)).toEqual(['/api/agents/analyst/select'])
    expect(wrapper.find('.agent-summary__name').text()).toBe('analyst')
    // 切换成功后收起面板
    expect(agentButton.attributes('aria-pressed')).toBe('false')
  })

  it('会话进行中切换入口置灰且不发切换请求（V-14 / FR-036）', async () => {
    const router = createRouter()
    const { wrapper, session } = mountChat(router)

    await waitFor(() => session.agents.currentAgent.value !== null, '当前数字人未加载')
    await wrapper.findAll('.chat-header__action')[2].trigger('click')
    await waitFor(() => router.countOf('GET', '/api/agents') === 1, '候选列表未拉取')
    await waitFor(() => session.agents.candidates.value.length === 2, '候选详情未就绪')

    // 进入进行中态
    ;(session.chat.phase as unknown as Ref<string>).value = 'streaming'
    await wrapper.vm.$nextTick()

    const switchButton = wrapper.findAll('.agent-panel__candidate')[1].find('.base-button')
    expect(switchButton.attributes('disabled')).toBeDefined()
    expect(switchButton.attributes('title')).toBe('会话进行中，无法切换数字人')

    await switchButton.trigger('click')
    expect(switchCalls(router)).toEqual([])
  })
})
