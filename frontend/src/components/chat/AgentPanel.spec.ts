import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DigitalHuman } from '../../api/types'
import AgentPanel from './AgentPanel.vue'

// jsdom 未实现 <dialog> 的模态方法，提供最小桩件
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    writable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    writable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    }),
  })
})

function agent(name: string, overrides: Partial<DigitalHuman> = {}): DigitalHuman {
  return {
    agent_name: name,
    soul: `我是 ${name}`,
    skills: [{ name: '排产', description: '生成排产方案' }],
    enabled_tools: ['read_file'],
    mcp_servers: [{ name: 'filesystem', transport: 'stdio' }],
    ...overrides,
  }
}

describe('AgentPanel', () => {
  it('未选择数字人时详情区提示、候选区提示', () => {
    const wrapper = mount(AgentPanel, { props: { open: true, current: null } })
    expect(wrapper.text()).toContain('尚未选择数字人')
    expect(wrapper.text()).toContain('暂无可切换的数字人')
  })

  it('展示描述、技能、已启用工具与 MCP 服务（FR-035）', () => {
    const wrapper = mount(AgentPanel, { props: { open: true, current: agent('ops') } })
    expect(wrapper.find('.agent-panel__name').text()).toBe('ops')
    expect(wrapper.find('.agent-panel__description').text()).toBe('我是 ops')
    expect(wrapper.text()).toContain('排产：生成排产方案')
    expect(wrapper.find('.agent-panel__tool').text()).toBe('read_file')
    expect(wrapper.text()).toContain('filesystem（stdio）')
  })

  it('描述为空时给出兜底文案', () => {
    const wrapper = mount(AgentPanel, {
      props: { open: true, current: agent('ops', { soul: '' }) },
    })
    expect(wrapper.find('.agent-panel__description').text()).toBe('暂无描述')
  })

  it('候选列表：当前项展示「当前」并禁用，其它项可切换（FR-037）', async () => {
    const wrapper = mount(AgentPanel, {
      props: {
        open: true,
        current: agent('ops'),
        candidates: [agent('ops'), agent('analyst', { skills: [], enabled_tools: [] })],
      },
    })

    const buttons = wrapper.findAll('.agent-panel__candidate .base-button')
    expect(buttons.map((button) => button.text())).toEqual(['当前', '切换'])
    expect(buttons[0].attributes('disabled')).toBeDefined()
    expect(buttons[1].attributes('disabled')).toBeUndefined()

    await buttons[1].trigger('click')
    expect(wrapper.emitted('switch')).toEqual([['analyst']])
  })

  it('会话进行中时切换按钮置灰并说明原因（FR-036 / V-14）', async () => {
    const wrapper = mount(AgentPanel, {
      props: {
        open: true,
        current: agent('ops'),
        candidates: [agent('analyst')],
        switchingDisabled: true,
      },
    })

    const button = wrapper.find('.agent-panel__candidate .base-button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toBe('会话进行中，无法切换数字人')

    await button.trigger('click')
    expect(wrapper.emitted('switch')).toBeUndefined()
  })

  it('切换请求进行中时禁止重复点击', async () => {
    const wrapper = mount(AgentPanel, {
      props: {
        open: true,
        current: agent('ops'),
        candidates: [agent('analyst')],
        busy: true,
      },
    })

    const button = wrapper.find('.agent-panel__candidate .base-button')
    expect(button.attributes('disabled')).toBeDefined()

    await button.trigger('click')
    expect(wrapper.emitted('switch')).toBeUndefined()
  })

  it('关闭按钮派发 close', async () => {
    const wrapper = mount(AgentPanel, { props: { open: true, current: agent('ops') } })
    await wrapper.find('.base-dialog__close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('点击候选名称：只读预览其配置，不发切换请求（标「预览中」并给出切换入口）', async () => {
    const wrapper = mount(AgentPanel, {
      props: {
        open: true,
        current: agent('ops'),
        candidates: [
          agent('ops'),
          agent('analyst', {
            soul: '我是 analyst',
            skills: [],
            enabled_tools: [],
            mcp_servers: [],
          }),
        ],
      },
    })

    await wrapper.findAll('.agent-panel__candidate-name')[1].trigger('click')

    expect(wrapper.emitted('switch')).toBeUndefined()
    expect(wrapper.find('.agent-panel__name').text()).toBe('analyst')
    expect(wrapper.find('.agent-panel__description').text()).toBe('我是 analyst')
    expect(wrapper.find('.agent-panel__preview-badge').text()).toBe('预览中')
    expect(wrapper.text()).toContain('未选中，仅查看配置')
    expect(wrapper.text()).toContain('暂无技能')
    expect(wrapper.text()).toContain('暂无已启用工具')
    expect(wrapper.text()).toContain('未挂载 MCP 服务')
  })

  it('预览项标记选中态；点击当前项名称回到当前视图', async () => {
    const wrapper = mount(AgentPanel, {
      props: { open: true, current: agent('ops'), candidates: [agent('ops'), agent('analyst')] },
    })

    const names = wrapper.findAll('.agent-panel__candidate-name')
    await names[1].trigger('click')
    expect(names[1].classes()).toContain('agent-panel__candidate-name--previewing')
    expect(names[1].attributes('aria-pressed')).toBe('true')
    expect(names[0].attributes('aria-pressed')).toBe('false')

    await names[0].trigger('click')
    expect(wrapper.find('.agent-panel__preview-badge').exists()).toBe(false)
    expect(wrapper.find('.agent-panel__name').text()).toBe('ops')
  })

  it('预览态的「切换到此数字人」派发 switch', async () => {
    const wrapper = mount(AgentPanel, {
      props: { open: true, current: agent('ops'), candidates: [agent('ops'), agent('analyst')] },
    })

    await wrapper.findAll('.agent-panel__candidate-name')[1].trigger('click')
    const button = wrapper.find('.agent-panel__preview-bar .base-button')
    expect(button.text()).toBe('切换到此数字人')

    await button.trigger('click')
    expect(wrapper.emitted('switch')).toEqual([['analyst']])
  })

  it('会话进行中仍可预览，仅切换入口置灰并说明原因（FR-036 / V-14）', async () => {
    const wrapper = mount(AgentPanel, {
      props: {
        open: true,
        current: agent('ops'),
        candidates: [agent('ops'), agent('analyst')],
        switchingDisabled: true,
      },
    })

    await wrapper.findAll('.agent-panel__candidate-name')[1].trigger('click')
    expect(wrapper.find('.agent-panel__name').text()).toBe('analyst')

    const button = wrapper.find('.agent-panel__preview-bar .base-button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toBe('会话进行中，无法切换数字人')

    await button.trigger('click')
    expect(wrapper.emitted('switch')).toBeUndefined()
  })

  it('切换成功后自动收敛回当前视图；关闭面板后重开亦复位', async () => {
    const wrapper = mount(AgentPanel, {
      props: {
        open: true,
        current: agent('ops'),
        candidates: [agent('ops'), agent('analyst'), agent('planner')],
      },
    })

    await wrapper.findAll('.agent-panel__candidate-name')[1].trigger('click')
    expect(wrapper.find('.agent-panel__preview-badge').exists()).toBe(true)

    // current 变为被预览者 → 预览态结束
    await wrapper.setProps({ current: agent('analyst') })
    expect(wrapper.find('.agent-panel__preview-badge').exists()).toBe(false)

    // 再次预览后关闭面板 → 复位回当前
    await wrapper.findAll('.agent-panel__candidate-name')[2].trigger('click')
    expect(wrapper.find('.agent-panel__preview-badge').exists()).toBe(true)
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect(wrapper.find('.agent-panel__preview-badge').exists()).toBe(false)
    expect(wrapper.find('.agent-panel__name').text()).toBe('analyst')
  })
})
