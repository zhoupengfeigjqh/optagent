/**
 * 组件测试：确认框（T035）
 *
 * 覆盖 `FR-007`：原生 `<dialog>`、Esc 关闭、确认/取消分支、关闭后状态回写。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConfirmDialog from './ConfirmDialog.vue'

describe('ConfirmDialog', () => {
  it('open 为 false 时 dialog 不带 open 属性', () => {
    const wrapper = mount(ConfirmDialog, { props: { open: false, title: '确认删除' } })
    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
  })

  it('open 为 true 时打开并展示标题与说明', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: { open: true, title: '确认删除', message: '该数字人将被移除' },
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
    expect(wrapper.text()).toContain('确认删除')
    expect(wrapper.text()).toContain('该数字人将被移除')
  })

  it('点击取消发出 update:open=false，不发出 confirm', async () => {
    const wrapper = mount(ConfirmDialog, { props: { open: true, title: '确认' } })
    await wrapper.find('[data-test="cancel"]').trigger('click')
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('点击确认先发出 confirm，再发出 update:open=false', async () => {
    const wrapper = mount(ConfirmDialog, { props: { open: true, title: '确认' } })
    await wrapper.find('[data-test="confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })

  it('Esc（cancel 事件）等价于取消，并阻止浏览器默认关闭', async () => {
    const wrapper = mount(ConfirmDialog, { props: { open: true, title: '确认' } })
    const event = new Event('cancel', { cancelable: true })
    await wrapper.find('dialog').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })

  it('危险性操作使用 danger 按钮样式', () => {
    const wrapper = mount(ConfirmDialog, {
      props: { open: true, title: '删除', danger: true },
    })
    expect(wrapper.find('[data-test="confirm"]').classes()).toContain('btn--danger')
  })

  it('自定义按钮文案生效', () => {
    const wrapper = mount(ConfirmDialog, {
      props: { open: true, title: 'x', confirmLabel: '覆盖', cancelLabel: '取消上传' },
    })
    expect(wrapper.find('[data-test="confirm"]').text()).toBe('覆盖')
    expect(wrapper.find('[data-test="cancel"]').text()).toBe('取消上传')
  })

  it('关闭时（open 由 true 变 false）移除 open 属性', async () => {
    const wrapper = mount(ConfirmDialog, { props: { open: true, title: 'x' } })
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ open: false })
    await wrapper.vm.$nextTick()
    const el = wrapper.find('dialog').element as HTMLDialogElement
    expect(el.hasAttribute('open')).toBe(false)
  })
})
