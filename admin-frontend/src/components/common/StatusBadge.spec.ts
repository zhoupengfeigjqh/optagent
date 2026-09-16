/**
 * 组件测试：状态徽标（T035）
 *
 * 守住原则四的**双通道**要求：状态不得只靠颜色区分。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import StatusBadge from './StatusBadge.vue'

describe('StatusBadge', () => {
  it('按状态词典显示中文名与图标（不只靠颜色）', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'running' } })
    expect(wrapper.text()).toContain('运行中')
    expect(wrapper.find('.status-badge__icon').text()).not.toBe('')
    expect(wrapper.classes()).toContain('status-badge--success')
  })

  it('四态各自有对应语义色', () => {
    const cases: Array<[string, string]> = [
      ['running', 'success'],
      ['stopped', 'neutral'],
      ['abnormal', 'error'],
      ['unknown', 'neutral'],
    ]
    for (const [status, tone] of cases) {
      const wrapper = mount(StatusBadge, { props: { status } })
      expect(wrapper.classes()).toContain(`status-badge--${tone}`)
    }
  })

  it('未知状态回退为原始文本而非空白', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'weird-state' } })
    expect(wrapper.text()).toContain('weird-state')
    expect(wrapper.classes()).toContain('status-badge--neutral')
  })

  it('label 与 tone 可覆盖词典值', () => {
    const wrapper = mount(StatusBadge, {
      props: { status: 'running', label: '已启动', tone: 'warning' },
    })
    expect(wrapper.text()).toContain('已启动')
    expect(wrapper.classes()).toContain('status-badge--warning')
  })
})
