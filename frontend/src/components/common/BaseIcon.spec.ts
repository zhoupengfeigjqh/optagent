import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BaseIcon from './BaseIcon.vue'

describe('BaseIcon', () => {
  it('按名称渲染对应路径', () => {
    const wrapper = mount(BaseIcon, { props: { name: 'close' } })
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.findAll('path')).toHaveLength(2)
  })

  it('默认尺寸 16，可自定义尺寸', () => {
    const wrapper = mount(BaseIcon, { props: { name: 'check' } })
    expect(wrapper.attributes('width')).toBe('16')
    expect(wrapper.attributes('height')).toBe('16')

    const sized = mount(BaseIcon, { props: { name: 'check', size: 24 } })
    expect(sized.attributes('width')).toBe('24')
  })

  it('未提供 label 时对读屏隐藏（纯装饰）', () => {
    const wrapper = mount(BaseIcon, { props: { name: 'check' } })
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.attributes('role')).toBeUndefined()
    expect(wrapper.attributes('aria-label')).toBeUndefined()
  })

  it('提供 label 时以 img 角色暴露名称', () => {
    const wrapper = mount(BaseIcon, { props: { name: 'search', label: '搜索' } })
    expect(wrapper.attributes('role')).toBe('img')
    expect(wrapper.attributes('aria-label')).toBe('搜索')
    expect(wrapper.attributes('aria-hidden')).toBeUndefined()
  })

  it('空字符串 label 视作装饰', () => {
    const wrapper = mount(BaseIcon, { props: { name: 'search', label: '  ' } })
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.attributes('role')).toBeUndefined()
  })

  it('未知名称不抛错且无路径', () => {
    const wrapper = mount(BaseIcon, { props: { name: 'not-exist' } })
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.findAll('path')).toHaveLength(0)
  })
})
