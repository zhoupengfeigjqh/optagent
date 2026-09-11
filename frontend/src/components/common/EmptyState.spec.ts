import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import EmptyState from './EmptyState.vue'

describe('EmptyState', () => {
  it('渲染标题与说明', () => {
    const wrapper = mount(EmptyState, {
      props: { title: '暂无会话', description: '新建一个会话开始对话' },
    })
    expect(wrapper.find('.empty-state__title').text()).toBe('暂无会话')
    expect(wrapper.find('.empty-state__description').text()).toBe('新建一个会话开始对话')
  })

  it('未提供说明时不渲染说明元素', () => {
    const wrapper = mount(EmptyState, { props: { title: '暂无内容' } })
    expect(wrapper.find('.empty-state__description').exists()).toBe(false)
  })

  it('action 插槽按需渲染', () => {
    const withoutAction = mount(EmptyState, { props: { title: '空' } })
    expect(withoutAction.find('.empty-state__action').exists()).toBe(false)

    const withAction = mount(EmptyState, {
      props: { title: '空' },
      slots: { action: '<button class="cta">新建</button>' },
    })
    expect(withAction.find('.empty-state__action .cta').exists()).toBe(true)
  })
})
