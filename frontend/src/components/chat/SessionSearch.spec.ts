import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SessionSearch from './SessionSearch.vue'

describe('SessionSearch', () => {
  it('open=false 时不渲染', () => {
    const wrapper = mount(SessionSearch)
    expect(wrapper.find('.session-search').exists()).toBe(false)
  })

  it('未输入关键词时给出引导文案，且「下一个」禁用', () => {
    const wrapper = mount(SessionSearch, { props: { open: true } })
    expect(wrapper.find('.session-search__status').text()).toBe('输入关键词开始搜索')
    expect(wrapper.find('.base-button--secondary').attributes('disabled')).toBeDefined()
  })

  it('展示「第 n / 共 m 项」', () => {
    const wrapper = mount(SessionSearch, {
      props: { open: true, keyword: '甲', total: 5, activeIndex: 2 },
    })
    expect(wrapper.find('.session-search__status').text()).toBe('第 3 / 共 5 项')
  })

  it('未定位时 n 记为 0', () => {
    const wrapper = mount(SessionSearch, {
      props: { open: true, keyword: '甲', total: 5, activeIndex: -1 },
    })
    expect(wrapper.find('.session-search__status').text()).toBe('第 0 / 共 5 项')
  })

  it('关键词非空且无匹配时展示无结果提示（US8 场景 3）', () => {
    const wrapper = mount(SessionSearch, { props: { open: true, keyword: '甲', total: 0 } })
    expect(wrapper.find('.session-search__status').text()).toBe('无匹配结果')
  })

  it('输入派发 update:keyword', async () => {
    const wrapper = mount(SessionSearch, { props: { open: true, keyword: '' } })
    await wrapper.find('.session-search__input').setValue('求解')
    expect(wrapper.emitted('update:keyword')).toEqual([['求解']])
  })

  it('点击「下一个」派发 next；有匹配时可用', async () => {
    const wrapper = mount(SessionSearch, {
      props: { open: true, keyword: '甲', total: 3, activeIndex: 0 },
    })
    const next = wrapper.find('.base-button--secondary')
    expect(next.attributes('disabled')).toBeUndefined()

    await next.trigger('click')
    expect(wrapper.emitted('next')).toHaveLength(1)
  })

  it('Enter 等价于 next，Esc 派发 close', async () => {
    const wrapper = mount(SessionSearch, {
      props: { open: true, keyword: '甲', total: 3, activeIndex: 0 },
    })
    const input = wrapper.find('.session-search__input')

    await input.trigger('keydown', { key: 'Enter' })
    await input.trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('next')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('关闭按钮派发 close', async () => {
    const wrapper = mount(SessionSearch, { props: { open: true, keyword: '甲', total: 1 } })
    await wrapper.find('[aria-label="关闭搜索"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('结果计数以 polite 实时区播报（SC-009）', () => {
    const wrapper = mount(SessionSearch, { props: { open: true, keyword: '甲', total: 2 } })
    expect(wrapper.find('.session-search__status').attributes('aria-live')).toBe('polite')
  })
})
