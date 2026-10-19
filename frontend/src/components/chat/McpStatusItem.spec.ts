/**
 * 组件测试：MCP 服务状态项（2026-10-18）。
 *
 * 守住两点：
 * 1. **双通道**：状态既有颜色类、也有文本，不靠颜色单独传达（FR-033 / FR-038 的口径）；
 * 2. **不露实现细节**：传输方式（`streamable-http` 等）不再出现在界面上。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import McpStatusItem from './McpStatusItem.vue'

describe('McpStatusItem —— 服务名 + 状态', () => {
  it('连接成功：名称与「连接正常」同时呈现，并带对应状态类', () => {
    const wrapper = mount(McpStatusItem, { props: { name: 'svc', status: 'connected' } })

    expect(wrapper.find('.mcp-status-item__name').text()).toBe('svc')
    expect(wrapper.find('.mcp-status-item__status').text()).toBe('连接正常')
    expect(wrapper.classes()).toContain('mcp-status-item--connected')
  })

  it('不显示传输方式：既没有该节点，文本里也不会漏出 `http`', () => {
    const wrapper = mount(McpStatusItem, { props: { name: 'svc', status: 'unknown' } })

    expect(wrapper.find('.mcp-status-item__transport').exists()).toBe(false)
    expect(wrapper.text()).toBe('svc未连接')
    expect(wrapper.html().toLowerCase()).not.toContain('http')
  })
})
