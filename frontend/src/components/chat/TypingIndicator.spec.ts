import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TypingIndicator from './TypingIndicator.vue'

describe('TypingIndicator', () => {
  it('以 status 角色与 polite 实时区暴露', () => {
    const wrapper = mount(TypingIndicator)
    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.attributes('aria-live')).toBe('polite')
  })

  it('默认文案为「思考中」', () => {
    const wrapper = mount(TypingIndicator)
    expect(wrapper.find('.typing-indicator__label').text()).toBe('思考中')
  })

  it('可自定义文案', () => {
    const wrapper = mount(TypingIndicator, { props: { label: '正在生成' } })
    expect(wrapper.find('.typing-indicator__label').text()).toBe('正在生成')
  })

  it('旋转动效对读屏隐藏', () => {
    const wrapper = mount(TypingIndicator)
    expect(wrapper.find('.typing-indicator__spinner').attributes('aria-hidden')).toBe('true')
  })
})
