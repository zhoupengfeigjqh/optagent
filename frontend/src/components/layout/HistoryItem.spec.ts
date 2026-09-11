import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { Conversation } from '../../api/types'
import HistoryItem from './HistoryItem.vue'

function thread(overrides: Partial<Conversation> = {}): Conversation {
  return {
    thread_id: 't1',
    agent_name: 'ops',
    title: '排产会话',
    created_at: '2026-09-10T08:00:00.000Z',
    updated_at: '2026-09-10T09:30:00.000Z',
    ...overrides,
  }
}

describe('HistoryItem', () => {
  it('展示标题与更新时间', () => {
    const wrapper = mount(HistoryItem, { props: { thread: thread() } })
    expect(wrapper.find('.history-item__title').text()).toBe('排产会话')
    expect(wrapper.find('.history-item__time').text()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('title 为 null 时展示「新会话」（FR-044）', () => {
    const wrapper = mount(HistoryItem, { props: { thread: thread({ title: null }) } })
    expect(wrapper.find('.history-item__title').text()).toBe('新会话')
  })

  it('超长标题经 title 属性提供全文', () => {
    const long = '很长的会话标题'.repeat(20)
    const wrapper = mount(HistoryItem, { props: { thread: thread({ title: long }) } })
    expect(wrapper.find('.history-item__button').attributes('title')).toBe(long)
  })

  it('点击派发 thread_id', async () => {
    const wrapper = mount(HistoryItem, { props: { thread: thread({ thread_id: 't9' }) } })
    await wrapper.find('.history-item__button').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['t9']])
  })

  it('选中态带 aria-current', () => {
    const wrapper = mount(HistoryItem, { props: { thread: thread(), active: true } })
    const button = wrapper.find('.history-item__button')
    expect(button.classes()).toContain('history-item__button--active')
    expect(button.attributes('aria-current')).toBe('true')
  })

  it('disabled 时按钮禁用且不派发 select', async () => {
    const wrapper = mount(HistoryItem, { props: { thread: thread(), disabled: true } })
    const button = wrapper.find('.history-item__button')
    expect(button.attributes('disabled')).toBeDefined()

    await button.trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('进行中的会话展示「进行中」标记', () => {
    const wrapper = mount(HistoryItem, { props: { thread: thread(), running: true } })
    expect(wrapper.find('.history-item__running').text()).toBe('进行中')

    const idle = mount(HistoryItem, { props: { thread: thread() } })
    expect(idle.find('.history-item__running').exists()).toBe(false)
  })

  it('提供删除入口并派发 remove（不触发 select，§3.5）', async () => {
    const wrapper = mount(HistoryItem, { props: { thread: thread({ thread_id: 't7' }) } })
    const remove = wrapper.find('.history-item__remove')

    expect(remove.exists()).toBe(true)
    expect(remove.attributes('aria-label')).toBe('删除会话：排产会话')

    await remove.trigger('click')

    expect(wrapper.emitted('remove')).toEqual([['t7']])
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('title 为 null 时删除入口的名称回退为「新会话」', () => {
    const wrapper = mount(HistoryItem, { props: { thread: thread({ title: null }) } })
    expect(wrapper.find('.history-item__remove').attributes('aria-label')).toBe('删除会话：新会话')
  })

  it('disabled 时删除入口禁用且不派发 remove', async () => {
    const wrapper = mount(HistoryItem, { props: { thread: thread(), disabled: true } })
    const remove = wrapper.find('.history-item__remove')
    expect(remove.attributes('disabled')).toBeDefined()

    await remove.trigger('click')
    expect(wrapper.emitted('remove')).toBeUndefined()
  })
})
