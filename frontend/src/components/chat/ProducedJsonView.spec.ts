/**
 * 组件测试：产出正文的只读结构化视图（按值递归）。
 *
 * 守住四条：
 * 1. **对象 → 键值行**；**对象数组 → 表格**（列 = 键并集）；**其他数组 → 列表**；
 * 2. **递归**：嵌套对象仍有独立行；
 * 3. **有界**：数组超上限只渲染前 N 行、表格列超上限只渲染前 N 列，均提示总数与逃生舱；
 *    深度超限交 JSON 逃生舱；
 * 4. **不裸奔**：空容器、null 都给可读占位（不留白）。
 */
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  PRODUCED_ARRAY_MAX_ITEMS,
  PRODUCED_JSON_MAX_DEPTH,
  PRODUCED_TABLE_MAX_COLUMNS,
} from '../../utils/produced-content'
import type { ViewLinkTarget } from '../../utils/view-link'
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
  it('数组超过上限：只渲染前 N 行，并提示总数与逃生舱', () => {
    const rows = Array.from({ length: PRODUCED_ARRAY_MAX_ITEMS + 3 }, (_v, i) => ({ i }))

    const wrapper = mountView(rows)

    expect(wrapper.findAll('tbody tr')).toHaveLength(PRODUCED_ARRAY_MAX_ITEMS)
    const hint = wrapper.find('.produced-json__truncated').text()
    expect(hint).toContain(`仅显示前 ${PRODUCED_ARRAY_MAX_ITEMS} 行`)
    expect(hint).toContain(`共 ${PRODUCED_ARRAY_MAX_ITEMS + 3} 行`)
    expect(hint).toContain('按原始 JSON 查看')
  })

  it('表格列超过上限：只渲染前 N 列，并提示总列数', () => {
    const wide = Object.fromEntries(
      Array.from({ length: PRODUCED_TABLE_MAX_COLUMNS + 2 }, (_v, i) => [`c${i}`, i]),
    )

    const wrapper = mountView([wide])

    expect(wrapper.findAll('th')).toHaveLength(PRODUCED_TABLE_MAX_COLUMNS)
    expect(wrapper.findAll('tbody td')).toHaveLength(PRODUCED_TABLE_MAX_COLUMNS)
    const hint = wrapper.find('.produced-json__truncated').text()
    expect(hint).toContain(`仅显示前 ${PRODUCED_TABLE_MAX_COLUMNS} 列`)
    expect(hint).toContain(`共 ${PRODUCED_TABLE_MAX_COLUMNS + 2} 列`)
  })

  it('未超上限：一行提示都不给（提示只在真截断时出现）', () => {
    expect(
      mountView([{ a: 1, b: 2 }])
        .find('.produced-json__truncated')
        .exists(),
    ).toBe(false)
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

describe('ProducedJsonView —— 视图链接（viewUrl，TR-40 / TR-41）', () => {
  /** 未传 origin 时组件取当前页面入口；断言按同一来源，避免硬编码主机 */
  const ORIGIN = window.location.origin

  it('字段名 viewUrl + 无前缀 → 渲染链接：文本 = 值本身，href 拼当前入口', () => {
    const wrapper = mountView({ viewUrl: '/datasource/dsdasds/dstsd/abc/xlsx' })

    const link = wrapper.find('.produced-json__link')
    expect(link.exists()).toBe(true)
    expect(link.text()).toBe('/datasource/dsdasds/dstsd/abc/xlsx')
    expect(link.attributes('href')).toBe(`${ORIGIN}/datasource/dsdasds/dstsd/abc/xlsx`)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })

  it('已带前缀 → href 与值完全一致（MUST NOT 被拼接）', () => {
    const raw = 'http://192.168.0.188:8080/datasource/x'

    expect(mountView({ viewUrl: raw }).find('.produced-json__link').attributes('href')).toBe(raw)
  })

  it('字段名大小写不敏感', () => {
    expect(mountView({ ViewUrl: '/a/b' }).find('.produced-json__link').exists()).toBe(true)
  })

  it('嵌套对象里的 viewUrl 也能点', () => {
    const wrapper = mountView({ data: { viewUrl: '/a/b' } })

    expect(wrapper.find('.produced-json__link').attributes('href')).toBe(`${ORIGIN}/a/b`)
  })

  it('对象数组表格：viewUrl 列渲染为链接', () => {
    const wrapper = mountView([{ orderNo: 'WO-1', viewUrl: '/a/b' }])

    const link = wrapper.find('tbody .produced-json__link')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe(`${ORIGIN}/a/b`)
  })

  it('值非法（协议相对 //）→ 不产生链接，按普通文本显示原文', () => {
    const wrapper = mountView({ viewUrl: '//evil.com/x' })

    expect(wrapper.find('.produced-json__link').exists()).toBe(false)
    expect(wrapper.find('.produced-json__scalar').text()).toBe('//evil.com/x')
  })

  it('值非法（无前导斜杠）→ 不产生链接', () => {
    expect(mountView({ viewUrl: 'datasource/x' }).find('.produced-json__link').exists()).toBe(false)
  })

  it('值非法（javascript scheme）→ 不产生链接', () => {
    expect(
      mountView({ viewUrl: 'javascript:alert(1)' }).find('.produced-json__link').exists(),
    ).toBe(false)
  })

  it('非字符串值 → 不产生链接（数字照常显示）', () => {
    const wrapper = mountView({ viewUrl: 123 })

    expect(wrapper.find('.produced-json__link').exists()).toBe(false)
    expect(wrapper.text()).toContain('123')
  })

  it('只按字段名判定：其它字段的值像路径也不链接化', () => {
    const wrapper = mountView({ path: '/api/files/raw' })

    expect(wrapper.find('.produced-json__link').exists()).toBe(false)
    expect(wrapper.text()).toContain('/api/files/raw')
  })

  it('无 viewUrl 的普通正文：渲染与改动前一致（回归）', () => {
    const wrapper = mountView({ status: 'success', message: '识别到 2 行文字' })

    expect(wrapper.find('.produced-json__link').exists()).toBe(false)
    expect(wrapper.findAll('.produced-json__key').map((node) => node.text())).toEqual([
      'status',
      'message',
    ])
  })
})

describe('ProducedJsonView —— 视图链接的点击口径（2026-10-20）', () => {
  const ORIGIN = window.location.origin

  /**
   * 用宿主组件接线（等价于装配层写 `@open-view`），并收集载荷。
   *
   * 不用 `mount(Comp, { attrs })`：VTU 不会把未声明的 `onXxx` 塞进 `vnode.props`，
   * 于是监听器根本没接上——那测的是 VTU 的挂载方式，不是真实接线。
   */
  function mountWired(value: unknown) {
    const received: ViewLinkTarget[] = []
    const Host = defineComponent({
      render: () =>
        h(ProducedJsonView, {
          value,
          onOpenView: (item: ViewLinkTarget) => received.push(item),
        }),
    })
    return { wrapper: mount(Host), received }
  }

  /** 派发一个真实左键点击，返回事件（用于断言 `defaultPrevented`） */
  function click(link: { element: Element }, init: MouseEventInit = {}): MouseEvent {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
    link.element.dispatchEvent(event)
    return event
  }

  it('普通左键 → 拦截导航 + 派发 open-view（同源判定交给上层）', () => {
    const { wrapper, received } = mountWired({ viewUrl: '/datasource/x' })

    const event = click(wrapper.find('.produced-json__link'))

    expect(event.defaultPrevented).toBe(true)
    expect(received).toEqual([
      { url: `${ORIGIN}/datasource/x`, name: '/datasource/x', kind: 'url' },
    ])
  })

  it('修饰键点击（Ctrl / Meta）不拦截：用户明确要新标签', () => {
    const { wrapper, received } = mountWired({ viewUrl: '/datasource/x' })
    const link = wrapper.find('.produced-json__link')

    expect(click(link, { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(click(link, { metaKey: true }).defaultPrevented).toBe(false)
    expect(received).toEqual([])
  })

  it('表格单元格里的 viewUrl 同样派发（任意层级生效）', () => {
    const { wrapper, received } = mountWired({ rows: [{ viewUrl: '/a/b' }] })

    const event = click(wrapper.find('tbody .produced-json__link'))

    expect(event.defaultPrevented).toBe(true)
    expect(received).toEqual([{ url: `${ORIGIN}/a/b`, name: '/a/b', kind: 'url' }])
  })
})
