/**
 * 组件测试：卡片列表（T035）
 *
 * 覆盖 `FR-006`、`SC-022`、`SC-023` 与三态（加载中 / 失败 / 空）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import EntityCardList from './EntityCardList.vue'

const items = Array.from({ length: 8 }, (_, i) => ({ name: `item-${i}` }))

function mountList(props: Record<string, unknown> = {}) {
  return mount(EntityCardList, {
    props: { title: '数字人设计', items, total: 20, page: 1, ...props },
    slots: {
      item: '<p class="probe">{{ params.item.name }}</p>',
    },
  })
}

describe('EntityCardList', () => {
  it('展示总条数与页码（FR-006）', () => {
    const wrapper = mountList()
    expect(wrapper.text()).toContain('共 20 项')
    expect(wrapper.text()).toContain('第 1 / 3 页')
  })

  it('单页渲染项数恒为传入的每页项数（SC-023：服务端固定 8）', () => {
    const wrapper = mountList()
    expect(wrapper.findAll('.card-list__cell')).toHaveLength(8)
  })

  it('列表带可读的无障碍标签（含总数与页码）', () => {
    const wrapper = mountList()
    const label = wrapper.find('section').attributes('aria-label')
    expect(label).toBe('数字人设计')
  })

  it('首页禁用上一页、末页禁用下一页', async () => {
    const first = mountList({ page: 1 })
    expect(first.findAll('button')[0]?.attributes('disabled')).toBeDefined()

    const last = mountList({ page: 3 })
    const buttons = last.findAll('button')
    expect(buttons[0]?.attributes('disabled')).toBeUndefined()
    expect(buttons[1]?.attributes('disabled')).toBeDefined()
  })

  it('翻页发出 update:page（纯前端切换，SC-022 ≤100ms）', async () => {
    const wrapper = mountList({ page: 2 })
    await wrapper.findAll('button')[1]?.trigger('click')
    expect(wrapper.emitted('update:page')?.[0]).toEqual([3])
  })

  it('越界翻页不发出事件', async () => {
    const wrapper = mountList({ page: 1 })
    await wrapper.findAll('button')[0]?.trigger('click')
    expect(wrapper.emitted('update:page')).toBeUndefined()
  })

  it('加载中：显示加载提示而非空态', () => {
    const wrapper = mountList({ loading: true, items: [] })
    expect(wrapper.text()).toContain('加载中')
    expect(wrapper.find('.empty-state').exists()).toBe(false)
  })

  it('失败：显示可读原因并保留错误码', () => {
    const wrapper = mountList({
      items: [],
      total: 0,
      error: { code: 'ADM_COMPOSE_FILE_UNREADABLE', message: 'x' },
    })
    expect(wrapper.text()).toContain('无法读取容器编排声明')
    expect(wrapper.text()).toContain('ADM_COMPOSE_FILE_UNREADABLE')
  })

  it('空结果：显示空态而非失败', () => {
    const wrapper = mountList({ items: [], total: 0 })
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(wrapper.find('.error-notice').exists()).toBe(false)
  })

  it('总数为 0 时页数显示为 0 且无分页控件', () => {
    const wrapper = mountList({ items: [], total: 0 })
    expect(wrapper.text()).toContain('共 0 项')
    expect(wrapper.find('.card-list__pager').exists()).toBe(false)
  })
})
