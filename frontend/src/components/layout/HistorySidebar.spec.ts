import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { Conversation } from '../../api/types'
import HistorySidebar from './HistorySidebar.vue'

function thread(index: number, overrides: Partial<Conversation> = {}): Conversation {
  return {
    thread_id: `t${index}`,
    agent_name: 'ops',
    title: `会话 ${index}`,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: `2026-09-10T00:${String(index).padStart(2, '0')}:00Z`,
    ...overrides,
  }
}

function range(count: number): Conversation[] {
  return Array.from({ length: count }, (_, index) => thread(index + 1))
}

describe('HistorySidebar', () => {
  it('默认按 10 条切片展示（V-09）', () => {
    const wrapper = mount(HistorySidebar, { props: { threads: range(15) } })
    expect(wrapper.findAll('.history-item')).toHaveLength(10)
    expect(wrapper.find('.history-sidebar__more').exists()).toBe(true)
  })

  it('limit=100 时展示至多 100 条且不再展示「更多」', () => {
    const wrapper = mount(HistorySidebar, { props: { threads: range(15), limit: 100 } })
    expect(wrapper.findAll('.history-item')).toHaveLength(15)
    expect(wrapper.find('.history-sidebar__more').exists()).toBe(false)
  })

  it('条数不超过 limit 时不展示「更多」', () => {
    const wrapper = mount(HistorySidebar, { props: { threads: range(3) } })
    expect(wrapper.find('.history-sidebar__more').exists()).toBe(false)
  })

  it('点击「更多」派发 more（切到 100 条）', async () => {
    const wrapper = mount(HistorySidebar, { props: { threads: range(20) } })
    await wrapper.find('.history-sidebar__more').trigger('click')
    expect(wrapper.emitted('more')).toHaveLength(1)
  })

  it('空列表展示空态，且「新建会话」仍可用（FR-043）', async () => {
    const wrapper = mount(HistorySidebar, { props: { threads: [] } })
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(wrapper.findAll('.history-item')).toHaveLength(0)

    const create = wrapper.find('.base-button')
    expect(create.attributes('disabled')).toBeUndefined()

    await create.trigger('click')
    expect(wrapper.emitted('create')).toHaveLength(1)
  })

  it('点击历史项派发 select', async () => {
    const wrapper = mount(HistorySidebar, { props: { threads: range(2) } })
    await wrapper.findAll('.history-item__button')[1].trigger('click')
    expect(wrapper.emitted('select')).toEqual([['t2']])
  })

  it('activeId 对应项为选中态', () => {
    const wrapper = mount(HistorySidebar, { props: { threads: range(3), activeId: 't2' } })
    const buttons = wrapper.findAll('.history-item__button')
    expect(buttons.map((button) => button.attributes('aria-current'))).toEqual([
      undefined,
      'true',
      undefined,
    ])
  })

  it('busy=true 时列表项全部禁用且不派发 select', async () => {
    const wrapper = mount(HistorySidebar, { props: { threads: range(2), busy: true } })
    const buttons = wrapper.findAll('.history-item__button')
    expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)

    await buttons[0].trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('busy 时仅活跃项展示「进行中」标记', () => {
    const wrapper = mount(HistorySidebar, {
      props: { threads: range(3), activeId: 't2', busy: true },
    })
    const markers = wrapper.findAll('.history-item__running')
    expect(markers).toHaveLength(1)
    expect(markers[0].text()).toBe('进行中')
  })

  it('loading 时展示加载指示且不渲染列表', () => {
    const wrapper = mount(HistorySidebar, { props: { threads: range(2), loading: true } })
    expect(wrapper.find('.loading-dots').exists()).toBe(true)
    expect(wrapper.find('.history-sidebar__list').exists()).toBe(false)
  })

  it('行内删除入口向上透传 remove（二次确认由装配层负责）', async () => {
    const wrapper = mount(HistorySidebar, { props: { threads: range(3) } })

    await wrapper.findAll('.history-item__remove')[1]?.trigger('click')

    expect(wrapper.emitted('remove')).toEqual([['t2']])
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('busy=true 时删除入口同样禁用', async () => {
    const wrapper = mount(HistorySidebar, { props: { threads: range(2), busy: true } })
    const removes = wrapper.findAll('.history-item__remove')
    expect(removes.every((button) => button.attributes('disabled') !== undefined)).toBe(true)

    await removes[0]?.trigger('click')
    expect(wrapper.emitted('remove')).toBeUndefined()
  })
})
