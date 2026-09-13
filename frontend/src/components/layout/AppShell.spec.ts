import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AppShell from './AppShell.vue'

describe('AppShell', () => {
  it('默认渲染左栏与中栏，收起预览列', () => {
    const wrapper = mount(AppShell)
    expect(wrapper.find('.app-shell__sidebar').exists()).toBe(true)
    expect(wrapper.find('.app-shell__main').exists()).toBe(true)
    expect(wrapper.find('.app-shell__preview').exists()).toBe(false)
    expect(wrapper.classes()).not.toContain('app-shell--preview-open')
  })

  it('previewOpen=true 时展开预览列', () => {
    const wrapper = mount(AppShell, { props: { previewOpen: true } })
    expect(wrapper.find('.app-shell__preview').exists()).toBe(true)
    expect(wrapper.classes()).toContain('app-shell--preview-open')
    expect(wrapper.find('.app-shell__preview').attributes('aria-label')).toBe('内容预览')
  })

  it('支持 sidebar / main / preview 插槽', () => {
    const wrapper = mount(AppShell, {
      props: { previewOpen: true },
      slots: {
        sidebar: '<div class="s">S</div>',
        main: '<div class="m">M</div>',
        preview: '<div class="p">P</div>',
      },
    })
    expect(wrapper.find('.app-shell__sidebar .s').exists()).toBe(true)
    expect(wrapper.find('.app-shell__main .m').exists()).toBe(true)
    expect(wrapper.find('.app-shell__preview .p').exists()).toBe(true)
  })

  it('兼容 history / chat 插槽别名', () => {
    const wrapper = mount(AppShell, {
      slots: {
        history: '<div class="h">H</div>',
        chat: '<div class="c">C</div>',
      },
    })
    expect(wrapper.find('.app-shell__sidebar .h').exists()).toBe(true)
    expect(wrapper.find('.app-shell__main .c').exists()).toBe(true)
  })

  it('sidebar 插槽优先于 history 别名', () => {
    const wrapper = mount(AppShell, {
      slots: {
        sidebar: '<div class="s">S</div>',
        history: '<div class="h">H</div>',
      },
    })
    expect(wrapper.find('.app-shell__sidebar .s').exists()).toBe(true)
    expect(wrapper.find('.app-shell__sidebar .h').exists()).toBe(false)
  })

  it('收起预览列时不渲染分隔条', () => {
    const wrapper = mount(AppShell)
    expect(wrapper.find('.app-shell__resizer').exists()).toBe(false)
  })

  it('展开预览列时提供具备 separator 语义的分隔条', () => {
    const wrapper = mount(AppShell, { props: { previewOpen: true } })
    const resizer = wrapper.find('.app-shell__resizer')

    expect(resizer.exists()).toBe(true)
    expect(resizer.attributes('role')).toBe('separator')
    expect(resizer.attributes('aria-orientation')).toBe('vertical')
    expect(resizer.attributes('aria-label')).toBe('调整文件空间宽度')
    expect(resizer.attributes('tabindex')).toBe('0')
  })

  it('方向键调整右栏宽度并注入 --layout-preview-width', async () => {
    const wrapper = mount(AppShell, { props: { previewOpen: true } })

    // jsdom 下元素尺寸为 0，宽度按基准 0 收敛到下限
    await wrapper.find('.app-shell__resizer').trigger('keydown', { key: 'ArrowLeft' })

    expect(wrapper.find('.app-shell').attributes('style')).toContain('--layout-preview-width: 280px')
  })
})
