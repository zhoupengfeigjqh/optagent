import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BaseDropdown from './BaseDropdown.vue'

const ITEMS = [
  { key: 'a', label: '选项 A' },
  { key: 'b', label: '选项 B', disabled: true },
  { key: 'c', label: '选项 C' },
]

describe('BaseDropdown', () => {
  it('触发器暴露 menu 语义与展开状态', () => {
    const wrapper = mount(BaseDropdown, { props: { items: ITEMS } })
    const trigger = wrapper.find('.base-dropdown__trigger')
    expect(trigger.attributes('aria-haspopup')).toBe('menu')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('点击触发器派发 toggle', async () => {
    const wrapper = mount(BaseDropdown, { props: { items: ITEMS } })
    await wrapper.find('.base-dropdown__trigger').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('展开时渲染菜单并同步 aria-expanded', () => {
    const wrapper = mount(BaseDropdown, { props: { items: ITEMS, open: true } })
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)
    expect(wrapper.find('.base-dropdown__trigger').attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(3)
  })

  it('关闭态下 ArrowDown 派发 toggle', async () => {
    const wrapper = mount(BaseDropdown, { props: { items: ITEMS } })
    await wrapper.find('.base-dropdown').trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('ArrowDown / ArrowUp 循环移动并跳过禁用项', async () => {
    const wrapper = mount(BaseDropdown, { props: { items: ITEMS, open: true } })
    const tabindexes = () =>
      wrapper.findAll('[role="menuitem"]').map((item) => item.attributes('tabindex'))
    expect(tabindexes()).toEqual(['0', '-1', '-1'])

    await wrapper.find('.base-dropdown').trigger('keydown', { key: 'ArrowDown' })
    expect(tabindexes()).toEqual(['-1', '-1', '0'])

    await wrapper.find('.base-dropdown').trigger('keydown', { key: 'ArrowDown' })
    expect(tabindexes()).toEqual(['0', '-1', '-1'])

    await wrapper.find('.base-dropdown').trigger('keydown', { key: 'ArrowUp' })
    expect(tabindexes()).toEqual(['-1', '-1', '0'])
  })

  it('Home / End 跳到首尾可选项', async () => {
    const wrapper = mount(BaseDropdown, { props: { items: ITEMS, open: true } })
    const tabindexes = () =>
      wrapper.findAll('[role="menuitem"]').map((item) => item.attributes('tabindex'))

    await wrapper.find('.base-dropdown').trigger('keydown', { key: 'End' })
    expect(tabindexes()).toEqual(['-1', '-1', '0'])

    await wrapper.find('.base-dropdown').trigger('keydown', { key: 'Home' })
    expect(tabindexes()).toEqual(['0', '-1', '-1'])
  })

  it('Enter 选中当前高亮项', async () => {
    const wrapper = mount(BaseDropdown, { props: { items: ITEMS, open: true, activeIndex: 2 } })
    await wrapper.find('.base-dropdown').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')).toEqual([['c']])
  })

  it('Esc 派发 close', async () => {
    const wrapper = mount(BaseDropdown, { props: { items: ITEMS, open: true } })
    await wrapper.find('.base-dropdown').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('点击菜单项派发 select，禁用项不派发', async () => {
    const wrapper = mount(BaseDropdown, { props: { items: ITEMS, open: true } })
    await wrapper.find('[data-index="1"]').trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()

    await wrapper.find('[data-index="0"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['a']])
  })

  it('点击组件外部派发 close', async () => {
    const wrapper = mount(BaseDropdown, { props: { items: ITEMS, open: true } })
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
