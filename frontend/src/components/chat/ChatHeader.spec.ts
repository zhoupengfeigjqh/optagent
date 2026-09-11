import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { DigitalHuman, McpServiceStatus } from '../../api/types'
import ChatHeader from './ChatHeader.vue'

const AGENT: DigitalHuman = {
  agent_name: 'ops',
  soul: '',
  skills: [],
  enabled_tools: [],
  mcp_servers: [],
}

const SERVERS: McpServiceStatus[] = [
  { name: 'filesystem', transport: 'stdio', status: 'connected' },
]

describe('ChatHeader', () => {
  it('未选定数字人时提示，且 MCP 区域不渲染（FR-032）', () => {
    const wrapper = mount(ChatHeader, { props: { agent: null, mcpServers: SERVERS } })
    expect(wrapper.find('.agent-summary__hint').text()).toBe('请选择数字人')
    expect(wrapper.find('.agent-summary__mcp').exists()).toBe(false)
  })

  it('已选定数字人时展示名称与 MCP 状态', () => {
    const wrapper = mount(ChatHeader, { props: { agent: AGENT, mcpServers: SERVERS } })
    expect(wrapper.find('.agent-summary__name').text()).toBe('ops')
    expect(wrapper.find('.mcp-status-item__status').text()).toBe('连接正常')
  })

  it('右上角三个按钮位可点击并派发对应事件（FR-008 布局契约）', async () => {
    const wrapper = mount(ChatHeader, { props: { agent: AGENT } })
    const buttons = wrapper.findAll('.chat-header__action')
    expect(buttons).toHaveLength(3)

    await buttons[0].trigger('click')
    await buttons[1].trigger('click')
    await buttons[2].trigger('click')

    expect(wrapper.emitted('toggle-search')).toHaveLength(1)
    expect(wrapper.emitted('toggle-workspace')).toHaveLength(1)
    expect(wrapper.emitted('toggle-agent')).toHaveLength(1)
  })

  it('按钮带无障碍名称与展开态', () => {
    const wrapper = mount(ChatHeader, {
      props: { agent: AGENT, searchOpen: true, workspaceOpen: false, agentPanelOpen: true },
    })
    const buttons = wrapper.findAll('.chat-header__action')
    expect(buttons.map((button) => button.attributes('aria-label'))).toEqual([
      '搜索对话',
      '工作空间',
      '数字人',
    ])
    expect(buttons.map((button) => button.attributes('aria-pressed'))).toEqual([
      'true',
      'false',
      'true',
    ])
  })
})
