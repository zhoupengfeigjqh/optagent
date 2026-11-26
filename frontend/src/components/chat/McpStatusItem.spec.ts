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
