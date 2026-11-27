import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SuggestionCard from './SuggestionCard.vue'

describe('SuggestionCard', () => {
  it('渲染文本；根节点是原生 button（键盘 Tab/Enter/Space 天然可达）', () => {
    const wrapper = mount(SuggestionCard, { props: { text: '按交付日期梳理订单风险' } })

    expect(wrapper.text()).toBe('按交付日期梳理订单风险')
    const element = wrapper.element as HTMLButtonElement
    expect(element.tagName).toBe('BUTTON')
    expect(element.type).toBe('button')
    expect(element.disabled).toBe(false)
    expect(element.getAttribute('tabindex')).toBeNull()
  })

  it('disabled → 置灰且不可点击（不发 select）', async () => {
    const wrapper = mount(SuggestionCard, { props: { text: '整理表格', disabled: true } })

    expect((wrapper.element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('点击发 select（确认与发送由上层决定）', async () => {
    const wrapper = mount(SuggestionCard, { props: { text: '整理表格' } })

    await wrapper.trigger('click')

    expect(wrapper.emitted('select')).toHaveLength(1)
  })

  it('`data-test` 由使用方传入并透传到根节点（两处使用各自命名）', () => {
    const wrapper = mount(SuggestionCard, {
      props: { text: '整理表格' },
      attrs: { 'data-test': 'next-step-0' },
    })

    expect(wrapper.attributes('data-test')).toBe('next-step-0')
  })
})
