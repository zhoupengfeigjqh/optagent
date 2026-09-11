import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ThinkingToggle from './ThinkingToggle.vue'

describe('ThinkingToggle', () => {
  it('默认快速模式：文案与 aria 状态一致', () => {
    const wrapper = mount(ThinkingToggle)
    expect(wrapper.find('.thinking-toggle__label').text()).toBe('快速')
    expect(wrapper.attributes('role')).toBe('switch')
    expect(wrapper.attributes('aria-checked')).toBe('false')
  })

  it('思考模式下文案与 aria 状态同步', async () => {
    const wrapper = mount(ThinkingToggle, { props: { thinking: true } })
    expect(wrapper.find('.thinking-toggle__label').text()).toBe('思考')
    expect(wrapper.attributes('aria-checked')).toBe('true')

    await wrapper.setProps({ thinking: false })
    expect(wrapper.find('.thinking-toggle__label').text()).toBe('快速')
    expect(wrapper.attributes('aria-checked')).toBe('false')
  })

  it('点击派发 toggle', async () => {
    const wrapper = mount(ThinkingToggle)
    await wrapper.trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('disabled 时禁用且不派发', async () => {
    const wrapper = mount(ThinkingToggle, { props: { disabled: true } })
    expect(wrapper.attributes('disabled')).toBeDefined()

    await wrapper.trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })
})
