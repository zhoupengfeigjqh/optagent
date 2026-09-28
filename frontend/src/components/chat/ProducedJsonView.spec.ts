/**
 * 组件测试：产出正文的只读结构化视图（按值递归）。
 *
 * 守住四条：
 * 1. **对象 → 键值行**；**对象数组 → 表格**（列 = 键并集）；**其他数组 → 列表**；
 * 2. **递归**：嵌套对象仍有独立行；
 * 3. **有界**：数组超上限只渲染前 N 项并提示；深度超限交 JSON 逃生舱；
 * 4. **不裸奔**：空容器、null 都给可读占位（不留白）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import {
  PRODUCED_ARRAY_MAX_ITEMS,
  PRODUCED_JSON_MAX_DEPTH,
} from '../../utils/produced-content'
import ProducedJsonView from './ProducedJsonView.vue'

function mountView(value: unknown, props: Record<string, unknown> = {}) {
  return mount(ProducedJsonView, { props: { value, ...props } })
}

describe('ProducedJsonView —— 分派', () => {
  it('对象 → 键值行（键与值都可读）', () => {
    const wrapper = mountView({ status: 'success', message: '识别到 2 行文字' })

    expect(wrapper.findAll('.produced-json__key').map((node) => node.text())).toEqual([
      'status',
      'message',
    ])
    expect(wrapper.text()).toContain('success')
    expect(wrapper.text()).toContain('识别到 2 行文字')
  })

  it('嵌套对象 → 递归出独立行', () => {
    const wrapper = mountView({ status: 'success', detail: { lines: 2, unit: '行' } })

    const keys = wrapper.findAll('.produced-json__key').map((node) => node.text())
    expect(keys).toContain('detail')
    expect(keys).toContain('lines')
    expect(keys).toContain('unit')
  })

  it('对象数组 → 表格：列 = 各元素键的并集', () => {
    const wrapper = mountView([
      { orderNo: 'WO-1', line: 'L1' },
      { orderNo: 'WO-2', start: '2026-09-26' },
    ])

    expect(wrapper.findAll('th').map((node) => node.text())).toEqual(['orderNo', 'line', 'start'])
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.text()).toContain('WO-1')
  })

  it('标量数组 → 列表（一行一项）', () => {
    const wrapper = mountView(['平静', '不满', '非常愤怒'])

    expect(wrapper.findAll('.produced-json__list-item')).toHaveLength(3)
    expect(wrapper.text()).toContain('非常愤怒')
  })

  it('空容器与 null 给可读占位（不留白）', () => {
    expect(mountView({}).text()).toBe('{}')
    expect(mountView([]).text()).toBe('[]')
    expect(mountView(null).text()).toBe('—')
  })
})

describe('ProducedJsonView —— 有界与逃生舱', () => {
  it('数组超过上限：只渲染前 N 项，并提示总数', () => {
    const rows = Array.from({ length: PRODUCED_ARRAY_MAX_ITEMS + 3 }, (_v, i) => ({ i }))

    const wrapper = mountView(rows)

    expect(wrapper.findAll('tbody tr')).toHaveLength(PRODUCED_ARRAY_MAX_ITEMS)
    expect(wrapper.find('.produced-json__truncated').text()).toContain(
      `共 ${PRODUCED_ARRAY_MAX_ITEMS + 3} 项`,
    )
  })

  it('标量数组同理有界并提示', () => {
    const wrapper = mountView(Array.from({ length: PRODUCED_ARRAY_MAX_ITEMS + 1 }, (_v, i) => i))

    expect(wrapper.findAll('.produced-json__list-item')).toHaveLength(PRODUCED_ARRAY_MAX_ITEMS)
    expect(wrapper.find('.produced-json__truncated').exists()).toBe(true)
  })

  it('深度超限 → JSON 逃生舱（不再递归）', () => {
    const wrapper = mountView({ deep: 1 }, { depth: PRODUCED_JSON_MAX_DEPTH })

    expect(wrapper.find('.produced-json__raw').exists()).toBe(true)
    expect(wrapper.find('.produced-json__key').exists()).toBe(false)
  })

  it('compact（表格单元格）：非标量以紧凑 JSON 呈现，标量仍是文本', () => {
    const wrapper = mountView([{ plain: 'x', nested: { a: 1 } }])

    const raw = wrapper.find('.produced-json__raw')
    expect(raw.exists()).toBe(true)
    expect(raw.text()).toContain('"a": 1')
    expect(wrapper.text()).toContain('x')
  })
})
