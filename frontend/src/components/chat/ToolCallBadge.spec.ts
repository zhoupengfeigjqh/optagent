import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ToolCallBadge from './ToolCallBadge.vue'

describe('ToolCallBadge', () => {
  it('展示工具名与默认状态「进行中」', () => {
    const wrapper = mount(ToolCallBadge, { props: { name: 'read_file' } })
    expect(wrapper.find('.tool-call-badge__name').text()).toBe('read_file')
    expect(wrapper.find('.tool-call-badge__status').text()).toBe('进行中')
    expect(wrapper.classes()).toContain('tool-call-badge--running')
  })

  it('按状态映射中文文案', () => {
    const success = mount(ToolCallBadge, { props: { name: 'solve', status: 'success' } })
    expect(success.find('.tool-call-badge__status').text()).toBe('已完成')

    const error = mount(ToolCallBadge, { props: { name: 'solve', status: 'error' } })
    expect(error.find('.tool-call-badge__status').text()).toBe('失败')
  })

  it('DOM 中只有工具名与状态，无入参/结果节点（V-04）', () => {
    const wrapper = mount(ToolCallBadge, { props: { name: 'solve', status: 'success' } })
    // 根节点下仅"名称"与"状态"两个子元素，不存在承载入参/结果的节点
    expect(wrapper.element.children).toHaveLength(2)
    expect(wrapper.text()).toBe('solve已完成')
    expect(wrapper.find('[data-args]').exists()).toBe(false)
    expect(wrapper.find('[data-result]').exists()).toBe(false)
  })
})
