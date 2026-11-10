/**
 * 组件测试：通用弹窗壳（2026-11-10）。
 *
 * 覆盖：原生 `<dialog>` 开关、Esc 关闭、footer 插槽、标题 id 唯一、关闭后焦点归还
 * （宪章原则四：键盘与读屏由原生 dialog 提供，壳只补焦点归还）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BaseDialog from './BaseDialog.vue'

describe('BaseDialog', () => {
  it('open 为 false 时 dialog 不带 open 属性', () => {
    const wrapper = mount(BaseDialog, { props: { open: false, title: '编辑' } })
    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
  })

  it('open 为 true 时打开，并展示标题与默认插槽', async () => {
    const wrapper = mount(BaseDialog, {
      props: { open: true, title: '编辑用户' },
      slots: { default: '<p class="body">内容</p>' },
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
    expect(wrapper.text()).toContain('编辑用户')
    expect(wrapper.find('.body').exists()).toBe(true)
  })

  it('标题 id 与 aria-labelledby 一致，且多实例互不撞号', async () => {
    const a = mount(BaseDialog, { props: { open: true, title: 'A' } })
    const b = mount(BaseDialog, { props: { open: true, title: 'B' } })
    await a.vm.$nextTick()
    await b.vm.$nextTick()

    const idA = a.find('dialog').attributes('aria-labelledby')
    const idB = b.find('dialog').attributes('aria-labelledby')
    expect(idA).toBeTruthy()
    expect(idA).not.toBe(idB)
    expect(a.find('h2').attributes('id')).toBe(idA)
    expect(b.find('h2').attributes('id')).toBe(idB)
  })

  it('提供 footer 插槽时渲染动作区', () => {
    const wrapper = mount(BaseDialog, {
      props: { open: true, title: 'x' },
      slots: { footer: '<button class="ok">保存</button>' },
    })
    expect(wrapper.find('.base-dialog__actions').exists()).toBe(true)
    expect(wrapper.find('.ok').text()).toBe('保存')
  })

  it('未提供 footer 插槽时不渲染动作区', () => {
    const wrapper = mount(BaseDialog, { props: { open: true, title: 'x' } })
    expect(wrapper.find('.base-dialog__actions').exists()).toBe(false)
  })

  it('Esc（cancel 事件）等价于取消，并阻止浏览器默认关闭', async () => {
    const wrapper = mount(BaseDialog, { props: { open: true, title: 'x' } })
    const event = new Event('cancel', { cancelable: true })
    await wrapper.find('dialog').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })

  it('打开后聚焦 [data-autofocus] 元素', async () => {
    const wrapper = mount(BaseDialog, {
      props: { open: false, title: 'x' },
      slots: { default: '<input class="first" data-autofocus />' },
      attachTo: document.body,
    })
    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(wrapper.find('.first').element)
    wrapper.unmount()
  })

  it('关闭后把焦点归还给打开前的元素', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const wrapper = mount(BaseDialog, {
      props: { open: false, title: 'x' },
      attachTo: document.body,
    })
    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ open: false })
    await wrapper.vm.$nextTick()

    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
    trigger.remove()
  })
})
