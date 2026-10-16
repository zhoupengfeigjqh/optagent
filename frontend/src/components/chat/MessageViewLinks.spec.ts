/**
 * 组件测试：回答正文之后的视图入口行（`TR-45` ~ `TR-48`）
 *
 * 守四件事：
 * 1. **空态整行不渲染** —— 没有合法链接时界面与改动前一致（无 DOM 即无间距）
 * 2. **归一化与去重只有一处实现** —— 已带前缀的值不被二次拼接、跨工具重复只出一个入口
 * 3. **降级链** —— 有名称用名称；无名称显示地址（中段省略），悬停永远给完整地址
 * 4. **溢出可见** —— 超过显示上限时给「另有 N 个」，展开与收起都在
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { ViewLink } from '../../api/types'
import type { ViewLinkTarget } from '../../utils/view-link'
import MessageViewLinks from './MessageViewLinks.vue'

/** 未传 origin 时组件取当前页面入口；断言按同一来源，避免硬编码主机 */
const ORIGIN = window.location.origin

function mountLinks(links: ViewLink[]) {
  return mount(MessageViewLinks, { props: { links } })
}

function rows(links: ViewLink[]) {
  return mountLinks(links).findAll('.message-view-link')
}

describe('MessageViewLinks —— 空态（TR-48）', () => {
  it('没有任何链接时整行不渲染', () => {
    expect(mountLinks([]).find('[data-test="view-links"]').exists()).toBe(false)
  })

  it('全是非法形态时同样不渲染（不产生"空壳行"）', () => {
    const wrapper = mountLinks([{ url: '//evil.com/x' }, { url: 'datasource/x' }])

    expect(wrapper.find('[data-test="view-links"]').exists()).toBe(false)
  })
})

describe('MessageViewLinks —— 归一化与去重（TR-45）', () => {
  it('无前缀 → href 拼当前入口；已带前缀 → 原样（绝不二次拼接）', () => {
    const all = rows([{ url: '/a/b' }, { url: 'http://other:8080/x' }])

    expect(all[0]?.attributes('href')).toBe(`${ORIGIN}/a/b`)
    expect(all[1]?.attributes('href')).toBe('http://other:8080/x')
  })

  it('跨工具重复的同一目标只出一个入口', () => {
    expect(rows([{ url: '/a' }, { url: `${ORIGIN}/a` }])).toHaveLength(1)
  })

  it('新窗口打开且带 rel（不把本页交出去）', () => {
    const link = rows([{ url: '/a' }])[0]

    expect(link?.attributes('target')).toBe('_blank')
    expect(link?.attributes('rel')).toContain('noopener')
    expect(link?.attributes('rel')).toContain('noreferrer')
  })
})

describe('MessageViewLinks —— 文案与降级链（TR-46）', () => {
  it('有名称 → 显示名称，悬停给「名称 — 完整地址」', () => {
    const link = rows([{ url: '/a/b', name: '一车间产能明细' }])[0]

    expect(link?.text()).toBe('一车间产能明细')
    expect(link?.attributes('title')).toBe(`一车间产能明细 — ${ORIGIN}/a/b`)
  })

  it('无名称 → 显示地址（中段省略），悬停仍给完整地址', () => {
    const raw = '/datasource/dsdasds/dstsd/abc/xlsx'
    const link = rows([{ url: raw }])[0]

    expect(link?.text()).toContain('…')
    expect(link?.text()).not.toBe(raw)
    expect(link?.text().startsWith('/datasource/')).toBe(true)
    expect(link?.attributes('title')).toBe(`${ORIGIN}${raw}`)
  })

  it('名称不会退化成"视图 1"之类占位（不推断、不编号）', () => {
    expect(rows([{ url: '/a/b' }])[0]?.text()).toBe('/a/b')
  })
})

describe('MessageViewLinks —— 上限与溢出（TR-47）', () => {
  const many = (count: number): ViewLink[] =>
    Array.from({ length: count }, (_value, index) => ({ url: `/ds/${index}` }))

  it('默认只显示前 3 个，其余走「另有 N 个」（不静默丢弃）', () => {
    const wrapper = mountLinks(many(5))

    expect(wrapper.findAll('.message-view-link')).toHaveLength(3)
    expect(wrapper.find('[data-test="view-links-more"]').text()).toBe('另有 2 个')
  })

  it('点「另有 N 个」展开全部，再点收起', async () => {
    const wrapper = mountLinks(many(5))

    await wrapper.find('[data-test="view-links-more"]').trigger('click')
    expect(wrapper.findAll('.message-view-link')).toHaveLength(5)

    const less = wrapper.findAll('button').at(-1)
    expect(less?.text()).toBe('收起')
    await less?.trigger('click')
    expect(wrapper.findAll('.message-view-link')).toHaveLength(3)
  })

  it('恰好等于显示上限时不出现溢出按钮（没有"被藏起来的东西"）', () => {
    expect(mountLinks(many(3)).find('[data-test="view-links-more"]').exists()).toBe(false)
  })
})

describe('MessageViewLinks —— 交互', () => {
  it('点击入口派发 open-view（归一化 href + 显示名 + 来源形态）', async () => {
    const wrapper = mountLinks([{ url: '/a' }])

    await wrapper.find('.message-view-link').trigger('click')

    expect(wrapper.emitted('open-view')).toEqual([
      [{ url: `${ORIGIN}/a`, name: '/a', kind: 'url' }],
    ])
  })

  it('有名称时派发的 name 与显示文案同源（不额外推断）', async () => {
    const wrapper = mountLinks([{ url: '/a/b', name: '一车间产能明细' }])

    await wrapper.find('.message-view-link').trigger('click')

    expect(wrapper.emitted('open-view')).toEqual([
      [{ url: `${ORIGIN}/a/b`, name: '一车间产能明细', kind: 'url' }],
    ])
  })

  it('filePath 入口：派发 kind:file + 原路径（上层据此走文件预览口径，不按地址预检）', async () => {
    const wrapper = mountLinks([{ url: '数据准备/9月计划.xlsx', kind: 'file' }])

    await wrapper.find('.message-view-link').trigger('click')

    const [payload] = (wrapper.emitted('open-view')?.[0] ?? []) as [ViewLinkTarget]

    expect(payload.kind).toBe('file')
    expect(payload.filePath).toBe('数据准备/9月计划.xlsx')
    expect(payload.name).toBe('数据准备/9月计划.xlsx')
    // `url` 仍是可点开的绝对地址（中键 / 复制链接照旧可用）
    expect(payload.url).toContain('/api/files/preview?dir=')
  })
})
