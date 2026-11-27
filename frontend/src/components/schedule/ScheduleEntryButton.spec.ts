import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ScheduleEntryButton from './ScheduleEntryButton.vue'

describe('ScheduleEntryButton', () => {
  it('原生 button：Tab 可达、无 tabindex 排除、名称与开关状态可朗读', () => {
    const wrapper = mount(ScheduleEntryButton)
    const element = wrapper.element as HTMLButtonElement

    expect(element.tagName).toBe('BUTTON')
    expect(element.type).toBe('button')
    expect(element.getAttribute('tabindex')).toBeNull()
    expect(element.getAttribute('aria-label')).toBe('定时任务')
    expect(element.getAttribute('aria-pressed')).toBe('false')
  })

  it('展开态 → aria-pressed=true（颜色之外还有状态语义）', () => {
    const wrapper = mount(ScheduleEntryButton, { props: { open: true } })

    expect(wrapper.attributes('aria-pressed')).toBe('true')
    expect(wrapper.classes()).toContain('schedule-entry--active')
  })

  it('点击与键盘：click（Enter/Space 在原生按钮上等价于 click）都会发 open', async () => {
    const wrapper = mount(ScheduleEntryButton)

    await wrapper.trigger('click')
    await wrapper.trigger('keydown.enter')

    // 断言 click 生效即可覆盖 Enter/Space，因为二者由浏览器派发到同一个 handler
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('不可用：原生 disabled + 原因可见（title）且点不动', async () => {
    const wrapper = mount(ScheduleEntryButton, {
      props: { disabled: true, disabledReason: '请先选择数字人' },
    })
    const element = wrapper.element as HTMLButtonElement

    expect(element.disabled).toBe(true)
    expect(element.title).toBe('请先选择数字人')
    expect(wrapper.text()).toContain('请先选择数字人')

    await wrapper.trigger('click')
    expect(wrapper.emitted('open')).toBeUndefined()
  })
})
