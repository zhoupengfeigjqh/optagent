import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { ToastItem } from '../../composables/useToast'
import ToastHost from './ToastHost.vue'

function item(overrides: Partial<ToastItem> = {}): ToastItem {
  return { id: 't1', level: 'info', text: '提示内容', action: null, ...overrides }
}

describe('ToastHost', () => {
  it('容器为 polite 实时区', () => {
    const wrapper = mount(ToastHost)
    expect(wrapper.find('.toast-host').attributes('aria-live')).toBe('polite')
    expect(wrapper.findAll('.toast-host__item')).toHaveLength(0)
  })

  it('渲染提示文本与级别样式', () => {
    const wrapper = mount(ToastHost, {
      props: { items: [item({ id: 'a', level: 'error', text: '发送失败' })] },
    })
    expect(wrapper.find('.toast-host__text').text()).toBe('发送失败')
    expect(wrapper.find('.toast-host__item').classes()).toContain('toast-host__item--error')
  })

  it('超过上限时只渲染前 3 条（兜底截断）', () => {
    const wrapper = mount(ToastHost, {
      props: {
        items: [
          item({ id: 'a', text: '1' }),
          item({ id: 'b', text: '2' }),
          item({ id: 'c', text: '3' }),
          item({ id: 'd', text: '4' }),
        ],
      },
    })
    expect(wrapper.findAll('.toast-host__item')).toHaveLength(3)
    expect(wrapper.text()).not.toContain('4')
  })

  it('点击关闭派发 dismiss(id)', async () => {
    const wrapper = mount(ToastHost, { props: { items: [item({ id: 'x' })] } })
    await wrapper.find('.toast-host__close').trigger('click')
    expect(wrapper.emitted('dismiss')).toEqual([['x']])
  })

  it('存在操作时渲染操作按钮并派发 action(id)', async () => {
    const wrapper = mount(ToastHost, {
      props: {
        items: [item({ id: 'x', action: { label: '重试', run: () => undefined } })],
      },
    })
    const action = wrapper.find('.toast-host__action')
    expect(action.text()).toBe('重试')

    await action.trigger('click')
    expect(wrapper.emitted('action')).toEqual([['x']])
  })

  it('无操作时不渲染操作按钮', () => {
    const wrapper = mount(ToastHost, { props: { items: [item({ id: 'x' })] } })
    expect(wrapper.find('.toast-host__action').exists()).toBe(false)
  })
})
