import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { DigitalHuman } from '../../api/types'
import AgentPanel from './AgentPanel.vue'

function agent(name: string): DigitalHuman {
  return {
    agent_name: name,
    description: '',
    intro: '',
    soul: '',
    skills: [],
    enabled_tools: [],
    mcp_servers: [],
  } as unknown as DigitalHuman
}

function setup(props: Record<string, unknown> = {}) {
  return mount(AgentPanel, {
    props: {
      open: true,
      current: agent('agent-a'),
      candidates: [agent('agent-a'), agent('agent-b')],
      ...props,
    },
    global: { stubs: { BaseDialog: { template: '<div><slot /></div>' } } },
  })
}

describe('AgentPanel —— 可切换时的正常态', () => {
  it('不禁用：无禁用提示、按钮可点、切换事件正常派发', async () => {
    const wrapper = setup({ switchingDisabled: false, switchingDisabledReason: null })

    expect(wrapper.find('.agent-panel__blocked').exists()).toBe(false)

    const buttons = wrapper.findAll('button.base-button')
    const switchButton = buttons[buttons.length - 1]!
    expect(switchButton.attributes('disabled')).toBeUndefined()
    expect(switchButton.attributes('aria-disabled')).toBeUndefined()

    await switchButton.trigger('click')
    expect(wrapper.emitted('switch')?.[0]).toEqual(['agent-b'])
  })

  it('切换请求进行中（busy）：按钮禁用，但没有"原因"提示（不是用户可解决的问题）', () => {
    const wrapper = setup({ busy: true, switchingDisabled: false })

    const buttons = wrapper.findAll('button.base-button')
    expect(buttons[buttons.length - 1]!.attributes('disabled')).toBeDefined()
    expect(wrapper.find('.agent-panel__blocked').exists()).toBe(false)
  })
})

describe('AgentPanel —— 禁用原因可读（FR-015 / T034）', () => {
  const reason = '当前对话已有消息，请先新建对话再切换数字人'

  it('禁用：原因渲染为 DOM 文本 + role=status，并以 aria-describedby 关联到按钮', () => {
    const wrapper = setup({ switchingDisabled: true, switchingDisabledReason: reason })

    const hint = wrapper.find('.agent-panel__blocked')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe(reason)
    expect(hint.attributes('role')).toBe('status')

    const described = wrapper
      .findAll('button.base-button')
      .filter((button) => button.attributes('aria-describedby') !== undefined)
    expect(described.length).toBeGreaterThan(0)
    for (const button of described) {
      expect(button.attributes('aria-describedby')).toBe(hint.attributes('id'))
      expect(button.attributes('disabled')).toBeDefined()
      expect(button.attributes('aria-disabled')).toBe('true')
      expect(button.attributes('title')).toBe(reason)
    }
  })

  it('点击被禁用的按钮不发切换事件（置灰必须真的不可用）', async () => {
    const wrapper = setup({ switchingDisabled: true, switchingDisabledReason: reason })

    const buttons = wrapper.findAll('button.base-button')
    for (const button of buttons) {
      await button.trigger('click')
    }

    expect(wrapper.emitted('switch')).toBeUndefined()
  })

  it('外部未给原因：回落到通用文案（禁用必有解释，不静默）', () => {
    const wrapper = setup({ switchingDisabled: true, switchingDisabledReason: null })

    expect(wrapper.find('.agent-panel__blocked').text()).toContain('无法切换数字人')
  })

  it('预览其他数字人时同样受禁用约束（预览只读，但切换要走同一道门）', async () => {
    const wrapper = setup({ switchingDisabled: true, switchingDisabledReason: reason })

    await wrapper.findAll('.agent-panel__candidate-name')[1]!.trigger('click')
    expect(wrapper.find('.agent-panel__preview-bar').exists()).toBe(true)

    const previewSwitch = wrapper.find('.agent-panel__preview-bar button.base-button')
    expect(previewSwitch.attributes('disabled')).toBeDefined()
    await previewSwitch.trigger('click')
    expect(wrapper.emitted('switch')).toBeUndefined()
  })
})
