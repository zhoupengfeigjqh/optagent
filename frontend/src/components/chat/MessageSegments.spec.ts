/**
 * 组件测试：分段渲染（2026-10-16，宪章偏差纠正——原缺同名测试）。
 *
 * 这个组件是"`.mark` 样式与 `data-match-index` 约定"的**唯一来源**：正文、代码块、表格单元格
 * 都经它落 DOM。它坏掉的症状很隐晦（高亮少一片、外链点了没反应），故把三种形态与叠加形态
 * 逐个钉住：
 * 1. 纯文本 / 高亮 / 外链三种基础形态；
 * 2. **高亮 + 外链叠加**（链接标签里出现搜索命中）——必须变成"可点的高亮"；
 * 3. `data-match-index` 的缺失语义（不带序号时属性不应出现，而不是渲染成 `undefined`）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { ContentSegment } from '../../utils/segments'
import MessageSegments from './MessageSegments.vue'

function mountSegments(segments: ContentSegment[]) {
  return mount(MessageSegments, { props: { segments } })
}

describe('MessageSegments —— 三种基础形态（2026-10-16）', () => {
  it('纯文本分段：只落文本，不产生 mark / a', () => {
    const wrapper = mountSegments([{ type: 'text', text: '普通正文' }])

    expect(wrapper.text()).toBe('普通正文')
    expect(wrapper.find('mark').exists()).toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('高亮分段：渲染 mark，并带全局命中序号', () => {
    const wrapper = mountSegments([{ type: 'mark', text: '产能', matchIndex: 7 }])

    const mark = wrapper.find('mark.message-content__mark')
    expect(mark.text()).toBe('产能')
    expect(mark.attributes('data-match-index')).toBe('7')
  })

  it('高亮但无序号：属性不出现（渲染成 "undefined" 会让 MessageList 定位不到任何命中）', () => {
    const wrapper = mountSegments([{ type: 'mark', text: '产能' }])

    expect(wrapper.find('mark').attributes('data-match-index')).toBeUndefined()
  })

  it('外链分段：新窗口直跳且带 noopener / noreferrer', () => {
    const wrapper = mountSegments([
      { type: 'link', text: 'https://a.b/c', href: 'https://a.b/c' },
    ])

    const link = wrapper.find('a.message-content__link')
    expect(link.text()).toBe('https://a.b/c')
    expect(link.attributes('href')).toBe('https://a.b/c')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })

  it('多分段按数组顺序渲染（分段是原文的无损切分，顺序即正确性）', () => {
    const wrapper = mountSegments([
      { type: 'text', text: '前' },
      { type: 'mark', text: '中', matchIndex: 0 },
      { type: 'text', text: '后' },
    ])

    expect(wrapper.text()).toBe('前中后')
  })
})

describe('MessageSegments —— 高亮与链接叠加（2026-10-16）', () => {
  it('链接内的命中：渲染为 <a> 包 <mark>，两者属性都在', () => {
    const wrapper = mountSegments([
      { type: 'mark', text: '文档', href: 'https://a.b/c', matchIndex: 3 },
    ])

    const link = wrapper.find('a.message-content__link')
    const mark = link.find('mark.message-content__mark')
    expect(link.attributes('href')).toBe('https://a.b/c')
    expect(mark.text()).toBe('文档')
    expect(mark.attributes('data-match-index')).toBe('3')
  })

  it('链接分段（非高亮）：<a> 内不产生 mark', () => {
    const wrapper = mountSegments([
      { type: 'link', text: 'https://a.b/c', href: 'https://a.b/c', matchIndex: 1 },
    ])

    expect(wrapper.find('a').exists()).toBe(true)
    expect(wrapper.find('mark').exists()).toBe(false)
  })
})

describe('MessageSegments —— open-link 派发（2026-10-16）', () => {
  it('点击外链派发 open-link（V-10 直跳由装配层兜底）', async () => {
    const wrapper = mountSegments([
      { type: 'link', text: 'https://a.b/c', href: 'https://a.b/c' },
    ])

    await wrapper.find('a.message-content__link').trigger('click')

    expect(wrapper.emitted('open-link')).toEqual([['https://a.b/c']])
  })

  it('链接内的命中被点击：同样派发（可点的高亮不是"看着能点"）', async () => {
    const wrapper = mountSegments([
      { type: 'mark', text: '文档', href: 'https://a.b/c', matchIndex: 0 },
    ])

    await wrapper.find('mark').trigger('click')

    expect(wrapper.emitted('open-link')).toEqual([['https://a.b/c']])
  })
})
