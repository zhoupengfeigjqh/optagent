/**
 * 单元测试：最小 Markdown 子集解析（2026-10-16）。
 *
 * 解析是渲染的地基：这里钉住"哪些语法被认、哪些原样当文本"，以及**偏移语义**
 * （每个片段都带原文 `start`，搜索高亮的全局序号全靠它，见 `MessageContent.vue`）。
 */
import { describe, expect, it } from 'vitest'

import { parseInline, parseMarkdown } from './markdown'

describe('parseMarkdown —— 块级', () => {
  it('段落：连续非空行合成一块，行间换行以片段保留', () => {
    const blocks = parseMarkdown('第一行\n第二行\n\n另起一段')

    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph'])
    const first = blocks[0]
    if (first.kind !== 'paragraph') throw new Error('首块应为段落')
    expect(first.runs.map((run) => run.text).join('')).toBe('第一行\n第二行')
  })

  it('标题：级别按 `#` 个数，标记不出现在文本里', () => {
    const blocks = parseMarkdown('### 结论')

    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    if (block.kind !== 'heading') throw new Error('应为标题块')
    expect(block.level).toBe(3)
    expect(block.runs.map((run) => run.text).join('')).toBe('结论')
  })

  it('围栏代码块：带语言，且收尾围栏缺失也能收束（流式中途的常态）', () => {
    const closed = parseMarkdown('```sql\nselect 1\nselect 2\n```')
    const block = closed[0]
    if (block.kind !== 'code') throw new Error('应为代码块')
    expect(block.language).toBe('sql')
    expect(block.piece.text).toBe('select 1\nselect 2')

    const streaming = parseMarkdown('```\n半截代码')
    const open = streaming[0]
    if (open.kind !== 'code') throw new Error('应为代码块')
    expect(open.piece.text).toBe('半截代码')
  })

  it('列表：无序 / 有序各成一类，条目可带行内标记', () => {
    const bullets = parseMarkdown('- 甲\n- **乙**')
    const bulletList = bullets[0]
    if (bulletList.kind !== 'list') throw new Error('应为列表块')
    expect(bulletList.ordered).toBe(false)
    expect(bulletList.items.map((item) => item.map((run) => run.text).join(''))).toEqual([
      '甲',
      '乙',
    ])
    expect(bulletList.items[1]?.[0]?.kind).toBe('strong')

    const numbered = parseMarkdown('1. 甲\n2. 乙')
    const orderedList = numbered[0]
    if (orderedList.kind !== 'list') throw new Error('应为列表块')
    expect(orderedList.ordered).toBe(true)
    expect(orderedList.items).toHaveLength(2)
  })

  it('表格：**必须**有分隔行才认（普通含竖线的句子不能被吃成表格）', () => {
    const table = parseMarkdown('| 工序 | 工时 |\n| --- | --- |\n| 冲压 | 3.2 |')
    expect(table).toHaveLength(1)
    const block = table[0]
    if (block.kind !== 'table') throw new Error('应为表格块')
    expect(block.header.map((cell) => cell.text)).toEqual(['工序', '工时'])
    expect(block.rows.map((row) => row.map((cell) => cell.text))).toEqual([['冲压', '3.2']])

    const sentence = parseMarkdown('产线 A | 产线 B 都在跑')
    expect(sentence[0]?.kind).toBe('paragraph')
  })

  it('引用与分隔线', () => {
    const quote = parseMarkdown('> 第一行\n> 第二行')
    const block = quote[0]
    if (block.kind !== 'quote') throw new Error('应为引用块')
    expect(block.runs.map((run) => run.text).join('')).toBe('第一行\n第二行')

    expect(parseMarkdown('---')[0]?.kind).toBe('rule')
  })
})

describe('parseInline —— 行内', () => {
  it('粗体 / 斜体 / 行内代码 / 链接各归各类，文本不含标记', () => {
    const runs = parseInline('**可以** 和 *也许* 与 `code` 见 [文档](https://a.b/c)', 0)

    expect(runs.map((run) => run.kind)).toEqual([
      'strong',
      'text',
      'em',
      'text',
      'code',
      'text',
      'link',
    ])
    expect(runs[0]?.text).toBe('可以')
    expect(runs[4]?.text).toBe('code')
    expect(runs[6]?.href).toBe('https://a.b/c')
  })

  it('偏移是**原文**坐标：搜索高亮靠它换算全局序号', () => {
    const source = '前缀 **加粗**'
    const runs = parseInline(source, 0)
    const strong = runs.find((run) => run.kind === 'strong')

    expect(strong?.start).toBe(5)
    const start = strong?.start ?? 0
    expect(source.slice(start, start + (strong?.text.length ?? 0))).toBe('加粗')
  })

  it('协议不可信的"链接"退化为普通文本（不给注入留口子）', () => {
    const source = '[点我](javascript:alert(1))'
    const runs = parseInline(source, 0)

    expect(runs.some((run) => run.kind === 'link')).toBe(false)
    expect(runs.map((run) => run.text).join('')).toBe(source)
  })

  it('`snake_case` 不被当成斜体（刻意不支持 `_` 变体）', () => {
    const runs = parseInline('order_status 字段', 0)

    expect(runs).toHaveLength(1)
    expect(runs[0]?.kind).toBe('text')
  })
})
