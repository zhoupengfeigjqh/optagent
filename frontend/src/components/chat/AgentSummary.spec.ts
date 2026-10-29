/**
 * 组件测试：数字人概要（014 改造后只保留身份信息）。
 *
 * 关键回归点：MCP 状态已迁到 `McpStatusList`，本组件 MUST NOT 再渲染状态列表，
 * 否则会出现"一份状态两处显示、且其中一处没对齐"的旧问题。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AgentSummary from './AgentSummary.vue'

describe('AgentSummary', () => {
  it('展示数字人名称', () => {
    const wrapper = mount(AgentSummary, { props: { agentName: '生产调度助手' } })

    expect(wrapper.text()).toContain('生产调度助手')
  })

  it('未选定时回落为「请选择数字人」提示', () => {
    const wrapper = mount(AgentSummary, { props: { agentName: null } })

    expect(wrapper.text()).toContain('请选择数字人')
  })

  it('不再渲染 MCP 状态列表（职责已迁出）', () => {
    const wrapper = mount(AgentSummary, { props: { agentName: '生产调度助手' } })

    expect(wrapper.find('ul').exists()).toBe(false)
    expect(wrapper.find('[aria-label="MCP 服务状态"]').exists()).toBe(false)
  })
})
