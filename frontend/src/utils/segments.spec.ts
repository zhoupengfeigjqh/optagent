import { describe, expect, it } from 'vitest'

import { buildSegments, type ContentSegment } from './segments'

/** 分段可拼接还原原文（V-不变式）。 */
function restore(segments: ContentSegment[]): string {
  return segments.map((segment) => segment.text).join('')
}

describe('buildSegments - 基本不变式', () => {
  it('空输入返回空数组', () => {
    expect(buildSegments('')).toEqual([])
  })

  it('无链接无关键词时返回单个 text 分段', () => {
    expect(buildSegments('普通文本，无链接。')).toEqual([
      { type: 'text', text: '普通文本，无链接。' },
    ])
  })

  it('分段按顺序拼接可还原原文（含链接与高亮）', () => {
    const content = '参考 https://example.com/doc 与 https://a.cn/x，关键词是 报告。'

    expect(restore(buildSegments(content, '报告'))).toBe(content)
    expect(restore(buildSegments(content, 'https'))).toBe(content)
    expect(restore(buildSegments(content, ''))).toBe(content)
  })

  it('分段无重叠且按位置有序', () => {
    const content = 'a https://x.com b https://y.com c'
    const segments = buildSegments(content, 'b')

    expect(restore(segments)).toBe(content)
    expect(segments.map((segment) => segment.type)).toEqual([
      'text',
      'link',
      'text',
      'mark',
      'text',
      'link',
      'text',
    ])
  })
})

describe('buildSegments - 链接识别', () => {
  it('识别 http 与 https 地址', () => {
    const segments = buildSegments('https://a.com 和 http://b.com')

    expect(segments.filter((segment) => segment.type === 'link')).toEqual([
      { type: 'link', text: 'https://a.com', href: 'https://a.com' },
      { type: 'link', text: 'http://b.com', href: 'http://b.com' },
    ])
  })

  it('剥离结尾中文标点', () => {
    const segments = buildSegments('详见 https://example.com/a。')

    expect(segments).toEqual([
      { type: 'text', text: '详见 ' },
      { type: 'link', text: 'https://example.com/a', href: 'https://example.com/a' },
      { type: 'text', text: '。' },
    ])
  })

  it('剥离结尾英文标点', () => {
    const segments = buildSegments('see https://example.com/a, and more')

    expect(segments[1]).toEqual({
      type: 'link',
      text: 'https://example.com/a',
      href: 'https://example.com/a',
    })
    expect(restore(segments)).toBe('see https://example.com/a, and more')
  })

  it('剥离不配对的右括号', () => {
    const segments = buildSegments('（见 https://example.com/a）')

    expect(segments[1]).toEqual({
      type: 'link',
      text: 'https://example.com/a',
      href: 'https://example.com/a',
    })
    expect(segments[2].text).toBe('）')
  })

  it('保留地址内成对的括号', () => {
    const url = 'https://en.wikipedia.org/wiki/Function_(mathematics)'
    const segments = buildSegments(url)

    expect(segments).toEqual([{ type: 'link', text: url, href: url }])
  })

  it('不识别非 http(s) 协议与裸域名', () => {
    const segments = buildSegments('ftp://a.com 与 www.a.com 都不算链接')

    expect(segments).toEqual([{ type: 'text', text: 'ftp://a.com 与 www.a.com 都不算链接' }])
  })

  it('同一地址出现多次时各自成段', () => {
    const segments = buildSegments('https://a.com https://a.com')

    expect(segments.filter((segment) => segment.type === 'link')).toHaveLength(2)
  })
})

describe('buildSegments - 关键词高亮', () => {
  it('命中片段为 mark 并携带全局序号', () => {
    const segments = buildSegments('报告与报告', '报告')

    expect(segments).toEqual([
      { type: 'mark', text: '报告', matchIndex: 0 },
      { type: 'text', text: '与' },
      { type: 'mark', text: '报告', matchIndex: 1 },
    ])
  })

  it('matchIndexBase 使序号跨消息连续', () => {
    const segments = buildSegments('报告', '报告', 5)

    expect(segments[0].matchIndex).toBe(5)
  })

  it('大小写不敏感匹配，但保留原文大小写', () => {
    const segments = buildSegments('Report and report', 'report')

    expect(segments).toEqual([
      { type: 'mark', text: 'Report', matchIndex: 0 },
      { type: 'text', text: ' and ' },
      { type: 'mark', text: 'report', matchIndex: 1 },
    ])
  })

  it('关键词含正则元字符时按字面量匹配', () => {
    const segments = buildSegments('价格为 (10) 元', '(10)')

    expect(segments).toEqual([
      { type: 'text', text: '价格为 ' },
      { type: 'mark', text: '(10)', matchIndex: 0 },
      { type: 'text', text: ' 元' },
    ])
  })

  it('空关键词与纯空白关键词不做高亮', () => {
    expect(buildSegments('abc', '')).toEqual([{ type: 'text', text: 'abc' }])
    expect(buildSegments('abc', '   ')).toEqual([{ type: 'text', text: 'abc' }])
  })

  it('无命中时全部为 text', () => {
    expect(buildSegments('abc', 'zzz')).toEqual([{ type: 'text', text: 'abc' }])
  })
})

describe('buildSegments - 高亮与链接叠加', () => {
  it('关键词落在链接内时该片段同时携带 href 与 matchIndex', () => {
    const content = '见 https://example.com/report 结尾'
    const segments = buildSegments(content, 'report')

    const marked = segments.filter((segment) => segment.type === 'mark')
    expect(marked).toHaveLength(1)
    expect(marked[0].matchIndex).toBe(0)
    expect(marked[0].href).toBe('https://example.com/report')
    expect(marked[0].text).toBe('report')

    expect(restore(segments)).toBe(content)
  })

  it('链接被高亮切分后，各片段共享同一 href', () => {
    const segments = buildSegments('https://a.com/x/y', 'com')

    expect(segments.map((segment) => segment.href)).toEqual([
      'https://a.com/x/y',
      'https://a.com/x/y',
      'https://a.com/x/y',
    ])
    expect(segments.map((segment) => segment.type)).toEqual(['link', 'mark', 'link'])
  })

  it('链接外的命中不带 href', () => {
    const segments = buildSegments('report https://a.com', 'report')

    expect(segments[0]).toEqual({ type: 'mark', text: 'report', matchIndex: 0 })
  })
})
