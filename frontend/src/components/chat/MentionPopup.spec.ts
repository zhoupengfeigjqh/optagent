import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const caretState = vi.hoisted(() => ({
  rect: null as null | { left: number; top: number; right: number; bottom: number },
}))

vi.mock('../../utils/caret-rect', () => ({
  caretRectOf: () => caretState.rect,
}))

import MentionPopup from './MentionPopup.vue'

let anchor: HTMLDivElement

beforeEach(() => {
  caretState.rect = { left: 200, top: 100, right: 200, bottom: 118 }
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', (): void => undefined)
  anchor = document.createElement('div')
  document.body.appendChild(anchor)
})

afterEach(() => {
  vi.unstubAllGlobals()
  anchor.remove()
})

function mountPopup(open = true) {
  return mount(MentionPopup, {
    props: { open, anchor, caret: 2 },
    slots: { default: '<div class="mention-popup__content">内容</div>' },
  })
}

describe('MentionPopup —— 渲染', () => {
  it('open=false 不渲染；open=true 就地渲染（不 Teleport）', async () => {
    expect(mountPopup(false).find('.mention-popup').exists()).toBe(false)

    const wrapper = mountPopup()
    await flushPromises()

    expect(wrapper.find('.mention-popup').exists()).toBe(true)
    expect(wrapper.html()).toContain('mention-popup__content')
  })

  it('展开时紧贴光标右侧落位', async () => {
    const wrapper = mountPopup()
    await flushPromises()

    const popup = wrapper.find('.mention-popup').element as HTMLElement
    expect(popup.style.left).toBe('206px')
    expect(popup.style.top).toBe('100px')
    expect(popup.dataset.side).toBe('right')
  })
})

describe('MentionPopup —— 跟随与降级', () => {
  it('滚动时重算，跟随光标移动', async () => {
    const wrapper = mountPopup()
    await flushPromises()

    caretState.rect = { left: 400, top: 150, right: 400, bottom: 168 }
    document.dispatchEvent(new Event('scroll'))

    const popup = wrapper.find('.mention-popup').element as HTMLElement
    expect(popup.style.left).toBe('406px')
    expect(popup.style.top).toBe('150px')
  })

  it('视口尺寸变化时同样重算', async () => {
    const wrapper = mountPopup()
    await flushPromises()

    caretState.rect = { left: 520, top: 240, right: 520, bottom: 258 }
    window.dispatchEvent(new Event('resize'))

    expect((wrapper.find('.mention-popup').element as HTMLElement).style.top).toBe('240px')
  })

  it('测不到光标（无布局）时退化为「贴锚点下方」，面板不消失', async () => {
    caretState.rect = null

    const wrapper = mountPopup()
    await flushPromises()

    expect(wrapper.find('.mention-popup').exists()).toBe(true)
    expect(wrapper.find('.mention-popup').attributes('data-side')).toBe('below')
  })
})

describe('MentionPopup —— Esc', () => {
  it('Esc 关闭面板（发出 close）', async () => {
    const wrapper = mountPopup()

    await wrapper.find('.mention-popup').trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('其它按键不触发 close', async () => {
    const wrapper = mountPopup()

    await wrapper.find('.mention-popup').trigger('keydown', { key: 'a' })

    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
