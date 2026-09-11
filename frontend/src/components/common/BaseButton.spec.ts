import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BaseButton from './BaseButton.vue'

describe('BaseButton', () => {
  it('默认渲染为 secondary / md 的 button', () => {
    const wrapper = mount(BaseButton, { slots: { default: '确定' } })
    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.classes()).toContain('base-button--secondary')
    expect(wrapper.classes()).toContain('base-button--md')
    expect(wrapper.text()).toBe('确定')
  })

  it('可指定 variant / size / type', () => {
    const wrapper = mount(BaseButton, {
      props: { variant: 'primary', size: 'sm', type: 'submit' },
      slots: { default: '提交' },
    })
    expect(wrapper.classes()).toContain('base-button--primary')
    expect(wrapper.classes()).toContain('base-button--sm')
    expect(wrapper.attributes('type')).toBe('submit')
  })

  it('点击派发 click 事件', async () => {
    const wrapper = mount(BaseButton, { slots: { default: '点我' } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('disabled 时禁止交互且不派发事件', async () => {
    const wrapper = mount(BaseButton, {
      props: { disabled: true },
      slots: { default: '禁用' },
    })
    expect(wrapper.attributes('disabled')).toBeDefined()
    expect(wrapper.attributes('aria-disabled')).toBe('true')

    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toBeUndefined()
  })

  it('loading 时展示加载态、禁用交互且不派发事件', async () => {
    const wrapper = mount(BaseButton, {
      props: { loading: true },
      slots: { default: '提交中' },
    })
    expect(wrapper.find('.base-button__spinner').exists()).toBe(true)
    expect(wrapper.attributes('disabled')).toBeDefined()
    expect(wrapper.attributes('aria-busy')).toBe('true')

    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toBeUndefined()
  })

  it('disabledReason 作为 title 说明禁用原因', () => {
    const wrapper = mount(BaseButton, {
      props: { disabled: true, disabledReason: '正在生成中，无法发送' },
      slots: { default: '发送' },
    })
    expect(wrapper.attributes('title')).toBe('正在生成中，无法发送')
  })
})
