/**
 * 组合式测试：放大态下按 Esc 退出（2026-10-16，011）
 *
 * 守三件事（对应 `specs/011-preview-maximize/data-model.md` 的 I5 / I6 不变式）：
 * 1. **非放大态 MUST NOT 挂监听** —— 否则会吞掉中栏既有的"Esc 中断本轮回答"；
 * 2. **放大态按 Esc 只退出放大** —— 事件被 `preventDefault` + `stopPropagation`，不冒泡到中栏；
 * 3. **有 `<dialog>` 打开时放行** —— 弹窗自己的 Esc 语义优先。
 *
 * 另有同源 iframe 文档的 Esc 转发：拿不到 `contentDocument` 时安全返回、同一文档只绑一次。
 */
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { bindFrameEscape, useMaximizeEscape } from './useMaximizeEscape'

/** 宿主组件：组合式需要组件上下文（`watch` / `onBeforeUnmount`）。 */
function mountHost(active: { value: boolean }, onRestore: () => void) {
  const Host = defineComponent({
    setup() {
      useMaximizeEscape({ active: () => active.value, onRestore })
      return () => null
    },
  })
  return mount(Host)
}

/** 在本页派发一次 Esc，返回事件本身（用于断言是否被拦下）。 */
function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
  window.dispatchEvent(event)
  return event
}

afterEach(() => {
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.remove())
})

describe('useMaximizeEscape —— 本页的 Esc', () => {
  it('非放大态**不挂**监听：Esc 照常留给中栏（FR-021 的"零变化"）', () => {
    const active = ref(false)
    const onRestore = vi.fn()
    const host = mountHost(active, onRestore)

    const event = pressEscape()

    expect(onRestore).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    host.unmount()
  })

  it('放大态：Esc 退出放大，并拦下这次按键（不冒泡到"中断本轮回答"）', () => {
    const active = ref(true)
    const onRestore = vi.fn()
    const host = mountHost(active, onRestore)

    const event = pressEscape()

    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    host.unmount()
  })

  it('退出放大后监听即摘除：再按 Esc 不再回调', async () => {
    const active = ref(true)
    const onRestore = vi.fn()
    const host = mountHost(active, onRestore)

    active.value = false
    await host.vm.$nextTick()

    pressEscape()

    expect(onRestore).not.toHaveBeenCalled()
    host.unmount()
  })

  it('组件卸载即摘除：卸载后按 Esc 不再回调', () => {
    const active = ref(true)
    const onRestore = vi.fn()
    const host = mountHost(active, onRestore)

    host.unmount()
    pressEscape()

    expect(onRestore).not.toHaveBeenCalled()
  })

  it('其他按键一律不管（不越权吞键）', () => {
    const active = ref(true)
    const onRestore = vi.fn()
    const host = mountHost(active, onRestore)

    const event = new KeyboardEvent('keydown', { key: 'a', cancelable: true, bubbles: true })
    window.dispatchEvent(event)

    expect(onRestore).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    host.unmount()
  })

  it('有 `<dialog>` 打开时**放行**：弹窗自己的 Esc 优先（I6）', () => {
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.appendChild(dialog)

    const active = ref(true)
    const onRestore = vi.fn()
    const host = mountHost(active, onRestore)

    const event = pressEscape()

    expect(onRestore).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    host.unmount()
  })
})

describe('bindFrameEscape —— 同源 iframe 文档内的 Esc', () => {
  /** 造一份独立文档，等价于同源 iframe 的 `contentDocument`。 */
  function createFrameDocument(): Document {
    return document.implementation.createHTMLDocument('frame')
  }

  function pressEscapeIn(doc: Document): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    doc.dispatchEvent(event)
    return event
  }

  it('文档内的 Esc 被转成一次"退出放大"', () => {
    const doc = createFrameDocument()
    const onRestore = vi.fn()
    bindFrameEscape(doc, onRestore)

    const event = pressEscapeIn(doc)

    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('同一文档只绑一次（重复 `load` 不叠加：按一次 Esc 只退一次）', () => {
    const doc = createFrameDocument()
    const first = vi.fn()
    const second = vi.fn()

    bindFrameEscape(doc, first)
    bindFrameEscape(doc, second)
    pressEscapeIn(doc)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('文档内的其他按键不触发', () => {
    const doc = createFrameDocument()
    const onRestore = vi.fn()
    bindFrameEscape(doc, onRestore)

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', cancelable: true }))

    expect(onRestore).not.toHaveBeenCalled()
  })

  it('拿不到 `contentDocument`（跨域 / PDF 插件文档）时安全返回，不抛错也不假装成功', () => {
    expect(() => bindFrameEscape(null, vi.fn())).not.toThrow()
  })
})
