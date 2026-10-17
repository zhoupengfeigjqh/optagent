/**
 * 组件测试：三栏工作台骨架（2026-10-16，011 补齐）
 *
 * 本文件是**同名测试补齐**：`AppShell.vue` 因 011（预览面板放大 / 缩小）而新增
 * `previewMaximized` 与放大态样式而被改动，按宪章原则三与治理"改动即约束"补齐——
 * 不是对存量组件发起的补测专项。
 *
 * 守三件事：
 * 1. 放大态只加一个**类**：`app-shell--preview-maximized`（铺满的定位在样式里，jsdom 算不出布局）
 * 2. 放大 **MUST NOT** 改写宽度变量——缩回后宽度逐像素一致（FR-004）是"没动过"保证的
 * 3. 既有能力（插槽、分隔条的键盘调整）在放大前后都照常
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AppShell from './AppShell.vue'

/** 三栏齐全的挂载（预览列展开，插槽各放一个标记元素）。 */
function mountShell(over: Partial<{ previewOpen: boolean; previewMaximized: boolean }> = {}) {
  return mount(AppShell, {
    props: { previewOpen: true, previewMaximized: false, ...over },
    slots: {
      history: '<div class="probe-history">历史</div>',
      chat: '<div class="probe-chat">聊天</div>',
      preview: '<div class="probe-preview">预览</div>',
    },
  })
}

describe('AppShell —— 三栏骨架与放大态（011）', () => {
  it('默认不是放大态：根节点没有放大类，也没有 `inert`', () => {
    const wrapper = mountShell()

    expect(wrapper.classes()).not.toContain('app-shell--preview-maximized')
    expect(wrapper.find('.app-shell__sidebar').attributes('inert')).toBeUndefined()
  })

  it('插槽照常渲染（别名插槽 `history` / `chat` 都能进中左两栏）', () => {
    const wrapper = mountShell()

    expect(wrapper.find('.probe-history').exists()).toBe(true)
    expect(wrapper.find('.probe-chat').exists()).toBe(true)
    expect(wrapper.find('.probe-preview').exists()).toBe(true)
    expect(wrapper.find('.app-shell__preview').attributes('aria-label')).toBe('内容预览')
  })

  it('`previewOpen=false` 时预览列与分隔条都不渲染（不占位）', () => {
    const wrapper = mountShell({ previewOpen: false })

    expect(wrapper.find('.app-shell__preview').exists()).toBe(false)
    expect(wrapper.find('.app-shell__resizer').exists()).toBe(false)
  })

  it('`previewMaximized=true` → 根节点带放大类（样式里把预览列 `fixed` 铺满视口）', () => {
    const wrapper = mountShell({ previewMaximized: true })

    expect(wrapper.classes()).toContain('app-shell--preview-maximized')
  })

  it('放大 **不改写**宽度变量：拖过宽度后放大再缩回，值原样（FR-004）', async () => {
    const wrapper = mountShell()
    const resizer = wrapper.find('.app-shell__resizer')

    // 分隔条左移一格：`useResizablePanel` 在 jsdom 里按默认基准算出下限宽度 280px
    await resizer.trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.attributes('style')).toContain('--layout-preview-width: 280px')

    await wrapper.setProps({ previewMaximized: true })
    expect(wrapper.attributes('style')).toContain('--layout-preview-width: 280px')

    await wrapper.setProps({ previewMaximized: false })
    expect(wrapper.attributes('style')).toContain('--layout-preview-width: 280px')
  })

  it('放大前后分隔条仍在 DOM（键盘调整照常；放大期间它被覆盖层挡住——见 inert 用例）', async () => {
    const wrapper = mountShell()

    await wrapper.setProps({ previewMaximized: true })

    const resizer = wrapper.find('.app-shell__resizer')
    expect(resizer.exists()).toBe(true)
    expect(resizer.attributes('role')).toBe('separator')
  })

  it('放大前后三栏都在 DOM 中（放大 MUST NOT 卸载任何一栏，FR-030）', async () => {
    const wrapper = mountShell()

    await wrapper.setProps({ previewMaximized: true })

    expect(wrapper.find('.app-shell__sidebar').exists()).toBe(true)
    expect(wrapper.find('.app-shell__main').exists()).toBe(true)
    expect(wrapper.find('.app-shell__preview').exists()).toBe(true)
  })

  it('放大态下左栏 / 中栏 / 分隔条一并 `inert`（焦点不会停在看不见的控件上）', async () => {
    const wrapper = mountShell()

    await wrapper.setProps({ previewMaximized: true })

    expect(wrapper.find('.app-shell__sidebar').attributes('inert')).toBeDefined()
    expect(wrapper.find('.app-shell__main').attributes('inert')).toBeDefined()
    expect(wrapper.find('.app-shell__resizer').attributes('inert')).toBeDefined()
    // 预览列自己**不** inert：它是唯一还能操作的地方
    expect(wrapper.find('.app-shell__preview').attributes('inert')).toBeUndefined()
  })

  it('缩回后 `inert` 全部撤掉（`inert` 是"存在即生效"的属性，绝不能留 `false` 在 DOM 上）', async () => {
    const wrapper = mountShell({ previewMaximized: true })

    await wrapper.setProps({ previewMaximized: false })

    expect(wrapper.find('.app-shell__sidebar').attributes('inert')).toBeUndefined()
    expect(wrapper.find('.app-shell__main').attributes('inert')).toBeUndefined()
    expect(wrapper.find('.app-shell__resizer').attributes('inert')).toBeUndefined()
  })
})
