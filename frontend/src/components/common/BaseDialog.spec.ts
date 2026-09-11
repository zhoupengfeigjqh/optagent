import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BaseDialog from './BaseDialog.vue'

// jsdom 未实现 <dialog> 的模态方法，这里提供最小桩件（同时同步 open 属性）
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '')
})
const close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open')
})

beforeEach(() => {
  showModal.mockClear()
  close.mockClear()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    writable: true,
    value: showModal,
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    writable: true,
    value: close,
  })
})

describe('BaseDialog', () => {
  it('open=false 时不调用 showModal', () => {
    mount(BaseDialog, { props: { open: false, title: '标题' } })
    expect(showModal).not.toHaveBeenCalled()
  })

  it('open 变为 true 时打开对话框', async () => {
    const wrapper = mount(BaseDialog, { props: { open: false, title: '标题' } })
    await wrapper.setProps({ open: true })
    expect(showModal).toHaveBeenCalledTimes(1)
    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
  })

  it('open 变为 false 时关闭对话框', async () => {
    const wrapper = mount(BaseDialog, { props: { open: true, title: '标题' } })
    expect(showModal).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ open: false })
    expect(close).toHaveBeenCalledTimes(1)
    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
  })

  it('Esc（cancel）阻止原生关闭并上报 close', () => {
    const wrapper = mount(BaseDialog, { props: { open: true, title: '标题' } })
    const dialog = wrapper.find('dialog').element as HTMLDialogElement
    const event = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('点击遮罩（dialog 自身）上报 close，点击内容不关闭', async () => {
    const wrapper = mount(BaseDialog, {
      props: { open: true, title: '标题' },
      slots: { default: '<div class="content">内容</div>' },
    })

    await wrapper.find('.content').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()

    await wrapper.find('dialog').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('点击右上角关闭按钮上报 close', async () => {
    const wrapper = mount(BaseDialog, { props: { open: true, title: '标题' } })
    await wrapper.find('.base-dialog__close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('标题与 aria-labelledby 关联', () => {
    const wrapper = mount(BaseDialog, { props: { open: true, title: '确认删除' } })
    const titleId = wrapper.find('.base-dialog__title').attributes('id')
    expect(titleId).toBeTruthy()
    expect(wrapper.find('dialog').attributes('aria-labelledby')).toBe(titleId)
  })

  it('labelledBy 覆盖内部标题 id；无标题时省略 aria-labelledby', () => {
    const overridden = mount(BaseDialog, {
      props: { open: true, title: '标题', labelledBy: 'external-id' },
    })
    expect(overridden.find('dialog').attributes('aria-labelledby')).toBe('external-id')

    const plain = mount(BaseDialog, { props: { open: true } })
    expect(plain.find('dialog').attributes('aria-labelledby')).toBeUndefined()
    expect(plain.find('.base-dialog__title').exists()).toBe(false)
  })

  it('footer 插槽按需渲染', () => {
    const without = mount(BaseDialog, { props: { open: true, title: '标题' } })
    expect(without.find('.base-dialog__footer').exists()).toBe(false)

    const withFooter = mount(BaseDialog, {
      props: { open: true, title: '标题' },
      slots: { footer: '<button class="ok">确定</button>' },
    })
    expect(withFooter.find('.base-dialog__footer .ok').exists()).toBe(true)
  })
})
