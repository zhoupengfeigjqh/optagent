import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { DigitalHuman, McpServiceStatus } from '../../api/types'
import ChatHeader from './ChatHeader.vue'

const auth = vi.hoisted(() => ({
  currentUser: { value: { user_id: 'admin' } as { user_id: string } | null },
  logout: vi.fn(async (): Promise<void> => undefined),
}))

vi.mock('../../composables/useAuth', () => ({ getAuthStore: () => auth }))

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
    expect(wrapper.get('.chat-header__identity-row').find('.mcp-status-list').exists()).toBe(false)
  })

  it('信息顺序保持「账号菜单（用户名） → 名称 → MCP 状态」（FR-002）', () => {
    const wrapper = mountHeader()

    const row = wrapper.get('.chat-header__identity-row')
    const trigger = row.get('.base-dropdown__trigger')
    expect(trigger.text()).toContain('admin')
    expect(row.text()).toContain('生产调度助手')
    expect(row.element.innerHTML.indexOf('base-dropdown')).toBeLessThan(
      row.element.innerHTML.indexOf('生产调度助手'),
    )
    const identityText = wrapper.get('.chat-header__identity').text()
    expect(identityText.indexOf('生产调度助手')).toBeLessThan(identityText.indexOf('ocr'))
  })

  it('未选定数字人时不渲染状态行，且仍显示「请选择数字人」（FR-004）', () => {
    const wrapper = mountHeader({ agent: null })

    expect(wrapper.find('.mcp-status-list').exists()).toBe(false)
    expect(wrapper.text()).toContain('请选择数字人')
  })

  it('点击「请选择数字人」按钮打开数字人面板', async () => {
    const wrapper = mountHeader({ agent: null })
    await wrapper.get('.agent-summary__hint').trigger('click')
    expect(wrapper.emitted('open-agent')).toHaveLength(1)
  })

  it('无可用数字人时隐藏搜索、工作空间与数字人切换入口', async () => {
    const wrapper = mountHeader({ agent: null, actionsDisabled: true, agentSwitchEnabled: false })

    expect(wrapper.find('[aria-label="搜索对话"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="工作空间"]').exists()).toBe(false)
    await wrapper.get('.base-dropdown__trigger').trigger('click')
    expect(wrapper.findAll('.base-dropdown__item').map((item) => item.text().trim())).toEqual([
      '退出登录',
    ])
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
    expect(wrapper.get('.chat-header__identity').element.children[1]!.className).toContain(
      'mcp-status-list',
    )
  })
})

describe('ChatHeader —— 账号菜单的意图转交', () => {
  it('选「切换数字人」→ 头部只上抛 open-agent（不自行打开面板）', async () => {
    const wrapper = mountHeader()

    await wrapper.get('.base-dropdown__trigger').trigger('click')
    await wrapper.findAll('.base-dropdown__item')[0]!.trigger('click')

    expect(wrapper.emitted('open-agent')).toHaveLength(1)
  })
})
