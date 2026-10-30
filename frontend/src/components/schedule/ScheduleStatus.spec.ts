/**
 * 组件测试：任务状态（015，T036）
 *
 * 唯一底线：**颜色不是唯一载体**。每个状态都必须有可读文字，圆点对读屏隐藏。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ScheduleStatus from './ScheduleStatus.vue'

describe('ScheduleStatus', () => {
  it('执行中：文字 + 圆点，圆点对读屏隐藏', () => {
    const wrapper = mount(ScheduleStatus, {
      props: { task: { status: 'running', terminated: false, disabled_reason: null } },
    })

    expect(wrapper.text()).toContain('执行中')
    expect(wrapper.find('.schedule-status__dot').attributes('aria-hidden')).toBe('true')
    expect(wrapper.classes()).toContain('schedule-status--running')
  })

  it('未开始', () => {
    const wrapper = mount(ScheduleStatus, {
      props: { task: { status: 'idle', terminated: false, disabled_reason: null } },
    })

    expect(wrapper.text()).toContain('未开始')
  })

  it('已结束（次数用尽时 enabled 仍为 true，靠文字区分）', () => {
    const wrapper = mount(ScheduleStatus, {
      props: { task: { status: 'running', terminated: true, disabled_reason: null } },
    })

    expect(wrapper.text()).toContain('已结束')
    expect(wrapper.text()).not.toContain('执行中')
  })

  it('数字人不可用：红点 + 明确文字', () => {
    const wrapper = mount(ScheduleStatus, {
      props: {
        task: { status: 'idle', terminated: false, disabled_reason: 'agent_unavailable' },
      },
    })

    expect(wrapper.text()).toContain('数字人不可用（已停用）')
    expect(wrapper.classes()).toContain('schedule-status--error')
  })
})
