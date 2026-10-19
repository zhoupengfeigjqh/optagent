/**
 * 组件测试：正文的最小 Markdown 渲染与搜索高亮（2026-10-16）。
 *
 * 两条主线：
 * 1. **结构**：标题/列表/表格/代码块渲染成形，标记本身不出现；
 * 2. **序号连续性**：片段换了渲染层，`data-match-index` 仍必须与 `useSessionSearch`
 *    按原文统计的口径一致——这是改造中最容易被踩坏、又最难在肉眼上发现的地方。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import MessageContent from './MessageContent.vue'

describe('MessageContent —— 最小 Markdown 渲染', () => {
  it('标题 / 列表 / 表格 / 代码块都渲染成结构，标记本身不出现', () => {
    const wrapper = mount(MessageContent, {
      props: {
        content: [
          '## 结论',
          '',
          '- 甲',
          '- 乙',
          '',
          '| 工序 | 工时 |',
          '| --- | --- |',
          '| 冲压 | 3.2 |',
          '',
          '```sql',
          'select 1',
          '```',
        ].join('\n'),
      },
    })

    // `##` → h4（正文层级压到 h3~h5，不与页面结构抢 h1/h2）
    expect(wrapper.find('h4').text()).toBe('结论')
    expect(wrapper.findAll('li').map((item) => item.text())).toEqual(['甲', '乙'])
    expect(wrapper.findAll('th').map((cell) => cell.text())).toEqual(['工序', '工时'])
    expect(wrapper.find('td').text()).toBe('冲压')
    expect(wrapper.find('pre code').text()).toBe('select 1')
    expect(wrapper.text()).not.toContain('##')
    expect(wrapper.text()).not.toContain('| ---')
  })

  it('行内标记：粗体 / 斜体 / 行内代码 / 外链', () => {
    const wrapper = mount(MessageContent, {
      props: { content: '**可以** *也许* `code` [文档](https://a.b/c)' },
    })

    expect(wrapper.find('strong').text()).toBe('可以')
    expect(wrapper.find('em').text()).toBe('也许')
    expect(wrapper.find('code').text()).toBe('code')
    expect(wrapper.find('a.message-content__link').attributes('href')).toBe('https://a.b/c')
  })

  it('段落之间的空行切段，手动换行保留', () => {
    const wrapper = mount(MessageContent, { props: { content: '第一行\n第二行\n\n另起一段' } })

    const paragraphs = wrapper.findAll('.message-content__text')
    expect(paragraphs.map((item) => item.text())).toEqual(['第一行\n第二行', '另起一段'])
  })
})

describe('MessageContent —— 搜索高亮（序号与原文口径一致）', () => {
  it('跨结构连续编号：标题里的命中是第 1 个、列表项里的是第 2 个', () => {
    const wrapper = mount(MessageContent, {
      props: {
        content: '## 产能计划\n\n- 产能 1200',
        keyword: '产能',
        matchIndexBase: 7,
      },
    })

    const marks = wrapper.findAll('mark[data-match-index]')
    expect(marks.map((mark) => mark.attributes('data-match-index'))).toEqual(['7', '8'])
    expect(marks.map((mark) => mark.text())).toEqual(['产能', '产能'])
  })

  it('代码块与表格单元格里的命中同样带序号（不因换渲染层而漏高亮）', () => {
    const code = mount(MessageContent, {
      props: { content: '```\n产能 1200\n```', keyword: '产能' },
    })
    expect(code.find('pre mark').attributes('data-match-index')).toBe('0')

    const table = mount(MessageContent, {
      props: {
        content: '| 产能 | 工时 |\n| --- | --- |\n| 1200 | 产能 |',
        keyword: '产能',
      },
    })
    expect(
      table.findAll('mark[data-match-index]').map((mark) => mark.attributes('data-match-index')),
    ).toEqual(['0', '1'])
  })

  it('关键词落在被丢掉的标记里：计数照旧按原文，页面上不产生高亮节点', () => {
    // `| ---` 是分隔行，标记被吃掉 ⇒ 无处可高亮；这里把"已知取舍"钉住，
    // 免得后来者以为渲染漏了
    const wrapper = mount(MessageContent, {
      props: { content: '| 甲 |\n| --- |\n| 1 |', keyword: '---' },
    })

    expect(wrapper.findAll('mark[data-match-index]')).toHaveLength(0)
    expect(wrapper.find('table').exists()).toBe(true)
  })
})

describe('MessageContent —— 外链与代码复制', () => {
  it('Markdown 链接点击派发 open-link（与正文外链同一口径）', async () => {
    const wrapper = mount(MessageContent, { props: { content: '见 [文档](https://a.b/c)' } })

    await wrapper.find('a.message-content__link').trigger('click')

    expect(wrapper.emitted('open-link')).toEqual([['https://a.b/c']])
  })

  it('复制的是**代码原文**：分段无损拼接，不带高亮标记', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const wrapper = mount(MessageContent, {
      props: { content: '```\nselect 1\nselect 2\n```', keyword: 'select' },
    })
    await wrapper.find('.message-code__copy').trigger('click')

    expect(writeText).toHaveBeenCalledWith('select 1\nselect 2')

    vi.unstubAllGlobals()
  })
})
