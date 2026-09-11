import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ThinkingBlock from './ThinkingBlock.vue'

describe('ThinkingBlock', () => {
  it('空文本不渲染', () => {
    const wrapper = mount(ThinkingBlock, { props: { text: '   ' } })
    expect(wrapper.find('.thinking-block').exists()).toBe(false)
  })

  it('默认收起并展示思考正文', () => {
    const wrapper = mount(ThinkingBlock, { props: { text: '先分析再求解' } })
    expect(wrapper.find('.thinking-block').attributes('open')).toBeUndefined()
    expect(wrapper.find('.thinking-block__body').text()).toBe('先分析再求解')
  })

  it('点击摘要可展开与收起', async () => {
    const wrapper = mount(ThinkingBlock, { props: { text: '思考内容' } })

    await wrapper.find('.thinking-block__summary').trigger('click')
    expect(wrapper.find('.thinking-block').attributes('open')).toBeDefined()

    await wrapper.find('.thinking-block__summary').trigger('click')
    expect(wrapper.find('.thinking-block').attributes('open')).toBeUndefined()
  })

  it('streaming 变化不改变展开状态', async () => {
    const wrapper = mount(ThinkingBlock, { props: { text: '思考内容' } })
    await wrapper.setProps({ streaming: true })
    expect(wrapper.find('.thinking-block').attributes('open')).toBeUndefined()

    await wrapper.find('.thinking-block__summary').trigger('click')
    await wrapper.setProps({ streaming: false })
    expect(wrapper.find('.thinking-block').attributes('open')).toBeDefined()
  })

  it('streaming 时展示「生成中」提示', () => {
    const wrapper = mount(ThinkingBlock, { props: { text: '思考内容', streaming: true } })
    expect(wrapper.find('.thinking-block__hint').text()).toBe('生成中')
  })
})
