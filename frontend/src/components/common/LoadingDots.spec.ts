import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import LoadingDots from './LoadingDots.vue'

describe('LoadingDots', () => {
  it('以 status 角色与 polite 实时区暴露', () => {
    const wrapper = mount(LoadingDots)
    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.attributes('aria-live')).toBe('polite')
  })

  it('默认文案为「加载中」', () => {
    const wrapper = mount(LoadingDots)
    expect(wrapper.find('.loading-dots__label').text()).toBe('加载中')
  })

  it('可自定义文案', () => {
    const wrapper = mount(LoadingDots, { props: { label: '正在生成回复' } })
    expect(wrapper.find('.loading-dots__label').text()).toBe('正在生成回复')
  })

  it('装饰性圆点对读屏隐藏', () => {
    const wrapper = mount(LoadingDots)
    expect(wrapper.find('.loading-dots__dots').attributes('aria-hidden')).toBe('true')
  })
})
