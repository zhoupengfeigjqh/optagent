import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BaseDialog from './BaseDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'

describe('ConfirmDialog', () => {
  it('渲染标题、说明与 取消/确认 两个按钮', () => {
    const wrapper = mount(ConfirmDialog, {
      props: { open: true, title: '删除会话', message: '不可恢复', confirmLabel: '删除' },
    })

    expect(wrapper.text()).toContain('删除会话')
    expect(wrapper.text()).toContain('不可恢复')
    const buttons = wrapper.findAll('.base-button')
    expect(buttons.map((button) => button.text())).toEqual(['取消', '删除'])
  })

  it('danger 时确认按钮使用危险样式；默认用主色', () => {
    const danger = mount(ConfirmDialog, { props: { open: true, title: '删除', danger: true } })
    expect(danger.find('.base-button--danger').exists()).toBe(true)

    const normal = mount(ConfirmDialog, { props: { open: true, title: '确认' } })
    expect(normal.find('.base-button--danger').exists()).toBe(false)
    expect(normal.find('.base-button--primary').exists()).toBe(true)
  })

  it('点击取消与确认分别派发对应事件', async () => {
    const wrapper = mount(ConfirmDialog, { props: { open: true, title: '确认' } })
    const buttons = wrapper.findAll('.base-button')

    await buttons[0]?.trigger('click')
    await buttons[1]?.trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('busy 时两个按钮都禁用，点击不派发（防重复提交）', async () => {
    const wrapper = mount(ConfirmDialog, { props: { open: true, title: '确认', busy: true } })
    const buttons = wrapper.findAll('.base-button')
    expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)

    await buttons[1]?.trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('BaseDialog 的关闭意图（Esc / 遮罩）收敛为 cancel', async () => {
    const wrapper = mount(ConfirmDialog, { props: { open: true, title: '确认' } })

    await wrapper.findComponent(BaseDialog).vm.$emit('close')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })
})
