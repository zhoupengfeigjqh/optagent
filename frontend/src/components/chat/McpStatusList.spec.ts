import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { McpServiceStatus } from '../../api/types'
import McpStatusList from './McpStatusList.vue'

const SERVERS: McpServiceStatus[] = [
  { name: 'ocr', transport: 'http', status: 'connected' },
  { name: 'bom', transport: 'stdio', status: 'failed' },
]

describe('McpStatusList', () => {
  it('有服务时逐项渲染，并以 MCP 服务状态命名列表', () => {
    const wrapper = mount(McpStatusList, { props: { servers: SERVERS } })

    expect(wrapper.attributes('aria-label')).toBe('MCP 服务状态')
    expect(wrapper.findAll('li')).toHaveLength(2)
    expect(wrapper.text()).toContain('ocr')
    expect(wrapper.text()).toContain('bom')
  })

  it('空数组不渲染容器（未选定 / 未配置 MCP 时不留空 ul）', () => {
    const wrapper = mount(McpStatusList, { props: { servers: [] } })

    expect(wrapper.find('ul').exists()).toBe(false)
  })

  it('默认 props 下同样不渲染容器', () => {
    const wrapper = mount(McpStatusList)

    expect(wrapper.find('ul').exists()).toBe(false)
  })
})
