import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import McpStatusItem from './McpStatusItem.vue'

describe('McpStatusItem', () => {
  it('连接正常：绿色类 + 文本双通道', () => {
    const wrapper = mount(McpStatusItem, {
      props: { name: 'filesystem', transport: 'stdio', status: 'connected' },
    })
    expect(wrapper.classes()).toContain('mcp-status-item--connected')
    expect(wrapper.find('.mcp-status-item__status').text()).toBe('连接正常')
    expect(wrapper.find('.mcp-status-item__name').text()).toBe('filesystem')
    expect(wrapper.find('.mcp-status-item__transport').text()).toBe('stdio')
  })

  it('连接失败：红色类 + 文本双通道', () => {
    const wrapper = mount(McpStatusItem, {
      props: { name: 'solver', transport: 'http', status: 'failed' },
    })
    expect(wrapper.classes()).toContain('mcp-status-item--failed')
    expect(wrapper.find('.mcp-status-item__status').text()).toBe('连接失败')
  })

  it('状态切换只更新类与文本，元素不重挂载', async () => {
    const wrapper = mount(McpStatusItem, {
      props: { name: 'filesystem', transport: 'stdio', status: 'failed' },
    })
    const element = wrapper.element
    const nameNode = wrapper.find('.mcp-status-item__name').element

    await wrapper.setProps({ status: 'connected' })

    expect(wrapper.element).toBe(element)
    expect(wrapper.find('.mcp-status-item__name').element).toBe(nameNode)
    expect(wrapper.classes()).toContain('mcp-status-item--connected')
    expect(wrapper.find('.mcp-status-item__status').text()).toBe('连接正常')
  })

  it('颜色指示点对读屏隐藏（状态已由文本表达）', () => {
    const wrapper = mount(McpStatusItem, {
      props: { name: 'a', transport: 'stdio', status: 'connected' },
    })
    expect(wrapper.find('.mcp-status-item__dot').attributes('aria-hidden')).toBe('true')
  })
})
