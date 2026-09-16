/**
 * 组件测试：数字人卡片列表（T059）
 *
 * 覆盖 `FR-014` / `FR-006`：卡片含名称与用途描述；异常卡片可辨识
 * 且**不影响其余卡片**。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AgentCardList from './AgentCardList.vue'
import type { AgentListItem } from '../../api/types'

const ITEMS: AgentListItem[] = [
  {
    name: 'demo',
    description: '生产计划助手',
    abnormal: false,
    abnormal_reason: null,
    updated_at: '2026-09-15T06:00:00.000Z',
  },
  {
    name: 'broken',
    description: '引用了失效工具',
    abnormal: true,
    abnormal_reason: '内置工具「ghost」已失效',
    updated_at: '2026-09-15T06:00:00.000Z',
  },
]

function mountList(overrides: Record<string, unknown> = {}) {
  return mount(AgentCardList, {
    props: {
      items: ITEMS,
      total: 2,
      page: 1,
      loading: false,
      error: null,
      ...overrides,
    },
  })
}

describe('AgentCardList', () => {
  it('卡片展示名称与用途描述', () => {
    const wrapper = mountList()
    expect(wrapper.text()).toContain('demo')
    expect(wrapper.text()).toContain('生产计划助手')
  })

  it('异常卡片可辨识：图标 + 文本 + 原因（不只靠颜色）', () => {
    const wrapper = mountList()
    const abnormal = wrapper.find('.card--abnormal')
    expect(abnormal.exists()).toBe(true)
    expect(abnormal.text()).toContain('异常')
    expect(abnormal.text()).toContain('ghost')
  })

  it('异常卡片不影响其余卡片', () => {
    const wrapper = mountList()
    expect(wrapper.findAll('.card')).toHaveLength(2)
    expect(wrapper.findAll('.card--abnormal')).toHaveLength(1)
  })

  it('无描述时给出占位而非空白', () => {
    const wrapper = mountList({
      items: [{ ...ITEMS[0]!, description: '' }],
    })
    expect(wrapper.text()).toContain('（无描述）')
  })

  it('点击「打开设计」发出 open(name)', async () => {
    const wrapper = mountList()
    const button = wrapper.findAll('button').find((b) => b.text() === '打开设计')
    await button?.trigger('click')
    expect(wrapper.emitted('open')?.[0]).toEqual(['demo'])
  })

  it('点击「新建数字人」发出 create', async () => {
    const wrapper = mountList()
    const button = wrapper.findAll('button').find((b) => b.text() === '新建数字人')
    await button?.trigger('click')
    expect(wrapper.emitted('create')).toHaveLength(1)
  })

  it('翻页透传 update:page', async () => {
    const wrapper = mountList({ total: 20 })
    const next = wrapper.findAll('button').find((b) => b.text() === '下一页')
    await next?.trigger('click')
    expect(wrapper.emitted('update:page')?.[0]).toEqual([2])
  })

  it('边界：空列表显示空态与引导', () => {
    const wrapper = mountList({ items: [], total: 0 })
    expect(wrapper.text()).toContain('还没有数字人')
  })

  it('边界：加载中不显示空态', () => {
    const wrapper = mountList({ items: [], total: 0, loading: true })
    expect(wrapper.text()).toContain('加载中')
  })

  it('边界：失败时显示可读原因与错误码', () => {
    const wrapper = mountList({
      items: [],
      total: 0,
      error: { code: 'ADM_RUNTIME_UNREACHABLE', message: 'x' },
    })
    expect(wrapper.text()).toContain('运行环境不可达')
    expect(wrapper.text()).toContain('ADM_RUNTIME_UNREACHABLE')
  })
})
