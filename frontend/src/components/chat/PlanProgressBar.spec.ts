import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlanProgressItem } from '../../composables/useChatStream.types'
import PlanProgressBar from './PlanProgressBar.vue'

function item(
  seqId: number,
  label: string,
  phase: PlanProgressItem['phase'] = 'running',
): PlanProgressItem {
  return { seqId, label, phase }
}

describe('PlanProgressBar', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('无进度 → 不渲染任何 DOM（不占位、不抖动正文）', () => {
    const wrapper = mount(PlanProgressBar, { props: { items: [] } })

    expect(wrapper.element.nodeType).toBe(Node.COMMENT_NODE)
    expect(wrapper.find('.plan-progress').exists()).toBe(false)
  })

  it('折叠态只占一行：第 N 步 · 步名（不带总步数、不带百分比）', () => {
    const wrapper = mount(PlanProgressBar, {
      props: { items: [item(1, '查询库存', 'done'), item(2, '创建采购')], active: true },
    })

    const bar = wrapper.find('.plan-progress__bar')
    expect(bar.text()).toContain('第 2 步 · 创建采购')
    expect(bar.text()).not.toContain('%')
    // 总数不作为承诺展示，只作为"查看"入口的计数
    expect(wrapper.find('.plan-progress__toggle').text()).toBe('2 步')
  })

  it('读屏：容器 role=status + aria-live=polite，进度变化会被播报', () => {
    const wrapper = mount(PlanProgressBar, { props: { items: [item(1, '查询库存')], active: true } })

    const root = wrapper.find('.plan-progress')
    expect(root.attributes('role')).toBe('status')
    expect(root.attributes('aria-live')).toBe('polite')
  })

  it('展开只列本轮已出现的步骤，按钮 aria-expanded 同步', async () => {
    const wrapper = mount(PlanProgressBar, {
      props: {
        items: [item(1, '查询库存', 'done'), item(2, '创建采购'), item(3, '确认到货')],
        active: true,
      },
    })

    const toggle = wrapper.find('.plan-progress__toggle')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.plan-progress__list').exists()).toBe(false)

    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    const rows = wrapper.findAll('.plan-progress__item')
    expect(rows.map((row) => row.text())).toEqual([
      '1查询库存已完成',
      '2创建采购进行中',
      '3确认到货进行中',
    ])
  })

  it('replanned → 文案提示"计划已调整"并闪一次（不是进度倒退）', () => {
    const wrapper = mount(PlanProgressBar, {
      props: { items: [item(3, '重新规划后的第一步', 'replanned')], active: true },
    })

    expect(wrapper.find('.plan-progress__note').text()).toBe('（计划已调整）')
    expect(wrapper.find('.plan-progress__bar--flash').exists()).toBe(true)
  })

  it('本轮结束：保留 1.5s 后淡出移除，不写历史也不留空白行', async () => {
    vi.useFakeTimers()
    const wrapper = mount(PlanProgressBar, {
      props: { items: [item(1, '查询库存', 'done')], active: false },
    })

    expect(wrapper.find('.plan-progress--fading').exists()).toBe(true)
    expect(wrapper.find('.plan-progress').exists()).toBe(true)

    vi.advanceTimersByTime(1500)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.plan-progress').exists()).toBe(false)
  })
})
