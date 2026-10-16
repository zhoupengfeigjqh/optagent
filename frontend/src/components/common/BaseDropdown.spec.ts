/**
 * 组件测试：下拉菜单弹层（`src/components/common/BaseDropdown.vue`）
 *
 * 2026-10-13 改为**视口安全浮窗**后新增本文件（按宪章原则三"随改动触达即补"）：
 * - 菜单坐标由脚本按**视口**写入内联 `left`/`top`，并标记 `data-side`；
 * - 下方放不下 ⇒ 翻到触发器**上方**（底部工具栏的模型选择不会弹到屏幕外）；
 * - 水平越界 ⇒ 夹取进视口（左右永不溢出）；
 * - 既有交互（外部点击关闭、Esc 关闭、方向键移动高亮）一并钉住。
 *
 * jsdom 不做布局（`getBoundingClientRect` 恒为 0），故用 stub 给出矩形与偏移尺寸。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BaseDropdown from './BaseDropdown.vue'

const ITEMS = [
  { key: 'a', label: '模型 A' },
  { key: 'b', label: '模型 B' },
]

type El = HTMLElement & { offsetWidth: number; offsetHeight: number }

/** 固定元素矩形（视口坐标系）。 */
function stubRect(el: Element, box: { left: number; top: number; width: number; height: number }) {
  const { left, top, width, height } = box
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect
}

/** 固定偏移尺寸（jsdom 恒为 0，否则测不出"下方放不下"）。 */
function stubSize(el: Element, width: number, height: number) {
  Object.defineProperty(el, 'offsetWidth', { value: width, configurable: true })
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true })
}

/** 等两帧：`schedule()` 走 rAF，滚动/改尺寸后的重算需要让帧回调跑完。 */
async function flushFrames(wrapper: ReturnType<typeof mount>): Promise<void> {
  const raf = (): Promise<void> =>
    new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
      else window.setTimeout(resolve, 0)
    })
  await raf()
  await raf()
  await wrapper.vm.$nextTick()
}

function mountClosed() {
  return mount(BaseDropdown, { props: { items: ITEMS, open: false }, attachTo: document.body })
}

describe('BaseDropdown —— 弹层定位（视口安全浮窗，2026-10-13）', () => {
  it('打开后把按视口算出的坐标写进内联样式，并标记 data-side', async () => {
    const wrapper = mountClosed()
    const trigger = wrapper.find('.base-dropdown__trigger')
    stubRect(trigger.element, { left: 100, top: 200, width: 120, height: 28 })

    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()

    const menu = wrapper.find('.base-dropdown__menu')
    // jsdom 下菜单尺寸为 0 ⇒ 下方一定放得下
    expect(menu.attributes('data-side')).toBe('below')
    expect((menu.element as El).style.left).toBe('100px')
    expect((menu.element as El).style.top).toBe('234px')
    wrapper.unmount()
  })

  it('触发器贴近底部（下方放不下）⇒ 翻到上方，且不遮住触发器', async () => {
    const wrapper = mountClosed()
    const trigger = wrapper.find('.base-dropdown__trigger')
    stubRect(trigger.element, { left: 100, top: 700, width: 120, height: 28 })

    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()

    // 菜单真实高度只能在挂载后测到 ⇒ 补齐尺寸再触发一次重算
    const menu = wrapper.find('.base-dropdown__menu')
    stubSize(menu.element, 220, 240)
    window.dispatchEvent(new Event('resize'))
    await flushFrames(wrapper)

    expect(menu.attributes('data-side')).toBe('above')
    expect((menu.element as El).style.top).toBe('454px')
    wrapper.unmount()
  })

  it('触发器贴近右缘 ⇒ 菜单左移夹取，右边缘不越出视口', async () => {
    const wrapper = mountClosed()
    const trigger = wrapper.find('.base-dropdown__trigger')
    // jsdom 视口宽 1024：菜单宽 220 ⇒ 最大 left = 1024 - 220 - 8 = 796
    stubRect(trigger.element, { left: 960, top: 100, width: 120, height: 28 })

    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()

    const menu = wrapper.find('.base-dropdown__menu')
    stubSize(menu.element, 220, 240)
    window.dispatchEvent(new Event('resize'))
    await flushFrames(wrapper)

    expect((menu.element as El).style.left).toBe('796px')
    wrapper.unmount()
  })

  it('滚动祖先时重算坐标（不依赖滚动容器）', async () => {
    const wrapper = mountClosed()
    const trigger = wrapper.find('.base-dropdown__trigger')
    stubRect(trigger.element, { left: 100, top: 200, width: 120, height: 28 })

    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()

    // 触发器被滚动推上去：坐标应随之更新
    stubRect(trigger.element, { left: 60, top: 20, width: 120, height: 28 })
    document.dispatchEvent(new Event('scroll'))
    await flushFrames(wrapper)

    expect(
      (wrapper.element as El).querySelector<HTMLElement>('.base-dropdown__menu')!.style.left,
    ).toBe('60px')
    wrapper.unmount()
  })
})

describe('BaseDropdown —— 既有交互不回归', () => {
  it('点击触发器 emit toggle；点击菜单项 emit select', async () => {
    const wrapper = mountClosed()
    await wrapper.find('.base-dropdown__trigger').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)

    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()
    await wrapper.findAll('.base-dropdown__item')[1]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['b']])
    wrapper.unmount()
  })

  it('组件外部按下指针 → emit close', async () => {
    const wrapper = mountClosed()
    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('Esc → emit close', async () => {
    const wrapper = mountClosed()
    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()

    await wrapper.find('.base-dropdown').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('ArrowDown 在展开态移动高亮（不关闭菜单）', async () => {
    const wrapper = mountClosed()
    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()

    await wrapper.find('.base-dropdown').trigger('keydown', { key: 'ArrowDown' })

    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.findAll('.base-dropdown__item--active')).toHaveLength(1)
    wrapper.unmount()
  })
})
