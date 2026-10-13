/**
 * 组件测试：建议卡片（007）。
 *
 * 这枚卡片同时服务两处（首屏问题实例 + 回答下方的下一步动作），因此它的断言都围绕
 * "只有文本"这条底线：文本渲染、置灰、点选上抛、`data-test` 透传。
 */
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
    // 没有任何"把自己排除在 Tab 序列之外"的设置
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
