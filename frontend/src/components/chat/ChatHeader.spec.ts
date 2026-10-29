/**
 * 组件测试：聊天区头部（014）。
 *
 * 对齐是像素问题，jsdom 没有布局引擎，因此这里守的是**结构前提**：
 * 状态行必须是身份容器的直接子项、与身份行平级且前面没有额外缩进容器——
 * 只有满足这个前提，"左边缘与切换按钮对齐"才成立（像素偏差另由手工 DevTools 核验）。
 *
 * 同时守住 FR-002（信息顺序）与 FR-004（未选定不渲染状态行）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { DigitalHuman, McpServiceStatus } from '../../api/types'
import ChatHeader from './ChatHeader.vue'

const AGENT = { agent_name: '生产调度助手' } as DigitalHuman

const SERVERS: McpServiceStatus[] = [
  { name: 'ocr', transport: 'http', status: 'connected' },
  { name: 'jev', transport: 'stdio', status: 'unknown' },
]

function mountHeader(props: Record<string, unknown> = {}) {
  return mount(ChatHeader, { props: { agent: AGENT, mcpServers: SERVERS, ...props } })
}

describe('ChatHeader —— MCP 状态左对齐（014 FR-001/002/004）', () => {
  it('状态行是身份容器的直接子项，与身份行平级（结构上保证左边缘一致）', () => {
    const wrapper = mountHeader()

    const identity = wrapper.get('.chat-header__identity')
    const children = Array.from(identity.element.children)

    expect(children[0]!.classList.contains('chat-header__identity-row')).toBe(true)
    expect(children[1]!.classList.contains('mcp-status-list')).toBe(true)
    // 状态行不在身份行**内部**：嵌在名称列里时起点会被按钮宽度推右
    expect(wrapper.get('.chat-header__identity-row').find('.mcp-status-list').exists()).toBe(false)
  })

  it('信息顺序保持「切换 → 名称 → MCP 状态」（FR-002）', () => {
    const wrapper = mountHeader()

    const row = wrapper.get('.chat-header__identity-row')
    expect(row.find('[aria-label="切换数字人"]').exists()).toBe(true)
    expect(row.text()).toContain('生产调度助手')
    // 状态行渲染在身份行之后
    const identityText = wrapper.get('.chat-header__identity').text()
    expect(identityText.indexOf('生产调度助手')).toBeLessThan(identityText.indexOf('ocr'))
  })

  it('未选定数字人时不渲染状态行，且仍显示「请选择数字人」（FR-004）', () => {
    const wrapper = mountHeader({ agent: null })

    expect(wrapper.find('.mcp-status-list').exists()).toBe(false)
    expect(wrapper.text()).toContain('请选择数字人')
  })

  it('长名称 + 多服务不破坏结构，右侧动作位仍在', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      name: `server-${index}`,
      transport: 'http',
      status: 'connected' as const,
    }))
    const wrapper = mountHeader({
      agent: { agent_name: '一个相当长的数字人名称用于验证换行与对齐不被破坏' } as DigitalHuman,
      mcpServers: many,
    })

    expect(wrapper.findAll('.mcp-status-list__item')).toHaveLength(8)
    expect(wrapper.find('[aria-label="搜索对话"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="工作空间"]').exists()).toBe(true)
    // 状态行仍是身份容器的第二个子项（对齐关系不因内容变长而改变）
    expect(wrapper.get('.chat-header__identity').element.children[1]!.className).toContain(
      'mcp-status-list',
    )
  })
})
