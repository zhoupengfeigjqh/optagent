import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { McpServiceStatus } from '../../api/types'
import AgentSummary from './AgentSummary.vue'

const SERVERS: McpServiceStatus[] = [
  { name: 'filesystem', transport: 'stdio', status: 'connected' },
  { name: 'solver', transport: 'http', status: 'failed' },
]

describe('AgentSummary', () => {
  it('未选定数字人时提示，且不渲染 MCP 列表容器（FR-032）', () => {
    const wrapper = mount(AgentSummary, { props: { agentName: null, mcpServers: SERVERS } })
    expect(wrapper.find('.agent-summary__hint').text()).toBe('请选择数字人')
    expect(wrapper.find('.agent-summary__name').exists()).toBe(false)
    expect(wrapper.find('.agent-summary__mcp').exists()).toBe(false)
  })

  it('已选定且无 MCP 服务时不渲染列表容器', () => {
    const wrapper = mount(AgentSummary, { props: { agentName: 'ops', mcpServers: [] } })
    expect(wrapper.find('.agent-summary__name').text()).toBe('ops')
    expect(wrapper.find('.agent-summary__mcp').exists()).toBe(false)
  })

  it('渲染 MCP 服务列表与状态文本', () => {
    const wrapper = mount(AgentSummary, { props: { agentName: 'ops', mcpServers: SERVERS } })
    expect(wrapper.findAll('.mcp-status-item')).toHaveLength(2)
    expect(
      wrapper.findAll('.mcp-status-item__status').map((node) => node.text()),
    ).toEqual(['连接正常', '连接失败'])
  })

  it('状态刷新时按服务名复用元素，不重挂载', async () => {
    const wrapper = mount(AgentSummary, { props: { agentName: 'ops', mcpServers: SERVERS } })
    const firstItem = wrapper.findAll('.agent-summary__mcp-item')[0].element

    await wrapper.setProps({
      mcpServers: [
        { name: 'filesystem', transport: 'stdio', status: 'failed' },
        { name: 'solver', transport: 'http', status: 'connected' },
      ],
    })

    expect(wrapper.findAll('.agent-summary__mcp-item')[0].element).toBe(firstItem)
    expect(
      wrapper.findAll('.mcp-status-item__status').map((node) => node.text()),
    ).toEqual(['连接失败', '连接正常'])
  })
})
