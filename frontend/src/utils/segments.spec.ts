import { describe, expect, it } from 'vitest'

import { buildSegments, countMatches, type ContentSegment } from './segments'

function joinSegments(segments: ContentSegment[]): string {
  return segments.map((segment) => segment.text).join('')
}

function outline(segments: ContentSegment[]): string[] {
  return segments.map((segment) => {
    const href = segment.href === undefined ? '' : `→${segment.href}`
    const mark = segment.matchIndex === undefined ? '' : `#${segment.matchIndex}`
    return `${segment.type}:${segment.text}${href}${mark}`
  })
}

describe('buildSegments - 基本分段', () => {
  it('空串 → 无分段', () => {
    expect(buildSegments('')).toEqual([])
  })

  it('纯文本 → 单个 text 分段', () => {
    expect(buildSegments('你好，世界')).toEqual([{ type: 'text', text: '你好，世界' }])
  })

  it('关键词为空或全空白 → 不做高亮', () => {
    expect(buildSegments('abc', '')).toEqual([{ type: 'text', text: 'abc' }])
    expect(buildSegments('abc', '   ')).toEqual([{ type: 'text', text: 'abc' }])
  })
})

describe('buildSegments - 链接识别', () => {
  it('链接切成 link 分段并携带 href', () => {
    const segments = buildSegments('访问 https://example.com 看看')
    expect(outline(segments)).toEqual([
      'text:访问 ',
      'link:https://example.com→https://example.com',
      'text: 看看',
    ])
  })

  it('剥离链接尾部的标点，标点回归为文本', () => {
    const segments = buildSegments('见 https://a.com。')
    expect(outline(segments)).toEqual(['text:见 ', 'link:https://a.com→https://a.com', 'text:。'])
  })

  it('地址内成对的括号保留（维基类地址常见）', () => {
    const url = 'https://en.wikipedia.org/wiki/Foo_(bar)'
    expect(buildSegments(url)).toEqual([{ type: 'link', text: url, href: url }])
  })

  it('不配对的右括号不计入地址（Markdown / 中文括号包裹的常见形态）', () => {
    expect(outline(buildSegments('(https://a.com)'))).toEqual([
      'text:(',
      'link:https://a.com→https://a.com',
      'text:)',
    ])
    expect(outline(buildSegments('（https://a.com）'))).toEqual([
      'text:（',
      'link:https://a.com→https://a.com',
      'text:）',
    ])
  })

  it('中文书名号 / 直角引号包裹时同样剥离', () => {
    expect(outline(buildSegments('【https://a.com】'))).toEqual([
      'text:【',
      'link:https://a.com→https://a.com',
      'text:】',
    ])
    expect(outline(buildSegments('「https://a.com」'))).toEqual([
      'text:「',
      'link:https://a.com→https://a.com',
      'text:」',
    ])
  })

  it('地址内成对的花括号保留（模板参数类地址）', () => {
    const url = 'https://a.com/{id}'
    expect(buildSegments(url)).toEqual([{ type: 'link', text: url, href: url }])
  })

  it('仅识别 http / https，其他协议原样为文本', () => {
    expect(buildSegments('ftp://a.com')).toEqual([{ type: 'text', text: 'ftp://a.com' }])
  })

  it('同一段文本中的多个链接各自成段', () => {
    const segments = buildSegments('https://a.com 与 https://b.com')
    expect(outline(segments)).toEqual([
      'link:https://a.com→https://a.com',
      'text: 与 ',
      'link:https://b.com→https://b.com',
    ])
  })
})

describe('buildSegments - 关键词高亮', () => {
  it('命中切成 mark 分段并带序号', () => {
    expect(outline(buildSegments('x foo y foo', 'foo'))).toEqual([
      'text:x ',
      'mark:foo#0',
      'text: y ',
      'mark:foo#1',
    ])
  })

  it('matchIndexBase 用于跨消息累计全局序号', () => {
    expect(outline(buildSegments('x foo y foo', 'foo', 5))).toEqual([
      'text:x ',
      'mark:foo#5',
      'text: y ',
      'mark:foo#6',
    ])
  })

  it('匹配大小写不敏感，但保留原文大小写', () => {
    expect(outline(buildSegments('Foo foo FOO', 'foo'))).toEqual([
      'mark:Foo#0',
      'text: ',
      'mark:foo#1',
      'text: ',
      'mark:FOO#2',
    ])
  })

  it('关键词按字面量匹配（正则元字符须转义）', () => {
    expect(countMatches('a.b axb', 'a.b')).toBe(1)
    expect(countMatches('a+b', 'a+b')).toBe(1)
    expect(countMatches('a(b', 'a(b')).toBe(1)
    expect(countMatches('a\\b', 'a\\b')).toBe(1)
  })

  it('关键词首尾空白被忽略', () => {
    expect(countMatches('foo', '  foo  ')).toBe(1)
  })
})

describe('buildSegments - 链接与高亮叠加', () => {
  it('关键词落在链接内 → 该分段同时携带 href 与 matchIndex', () => {
    const content = 'see https://example.com/a'
    const segments = buildSegments(content, 'example')
    expect(outline(segments)).toEqual([
      'text:see ',
      'link:https://→https://example.com/a',
      'mark:example→https://example.com/a#0',
      'link:.com/a→https://example.com/a',
    ])
    expect(joinSegments(segments)).toBe(content)
  })

  it('关键词覆盖整个链接 → 单一 mark 分段且仍可点击', () => {
    const url = 'https://a.com'
    expect(buildSegments(url, url)).toEqual([{ type: 'mark', text: url, href: url, matchIndex: 0 }])
  })
})

describe('countMatches 与 buildSegments 口径一致', () => {
  it('命中次数等于带序号的分段数', () => {
    const content = 'foo https://a.com foo bar'
    const segments = buildSegments(content, 'foo')
    const highlighted = segments.filter((segment) => segment.matchIndex !== undefined)
    expect(countMatches(content, 'foo')).toBe(2)
    expect(countMatches(content, 'foo')).toBe(highlighted.length)
  })

  it('空关键词 → 0 次', () => {
    expect(countMatches('foo', '')).toBe(0)
    expect(countMatches('foo', '   ')).toBe(0)
  })
})

describe('buildSegments - 拼接还原不变式', () => {
  const cases: Array<[string, string]> = [
    ['', ''],
    ['纯文本无链接无高亮', '链接'],
    ['访问 https://a.com 看看', ''],
    ['见 https://a.com。还有个 https://b.org/x', 'com'],
    ['（https://a.com）', 'a'],
    ['多行\nhttps://a.com\n第二行', '行'],
    ['中文标点：https://a.com、https://b.com；', 'https'],
    ['关键词紧跟链接https://a.comfoo结尾', 'foo'],
    ['https://a.com', 'https://a.com'],
    ['a', 'a'],
    ['   ', ' '],
  ]

  it.each(cases)('原文可还原：%s', (content, keyword) => {
    expect(joinSegments(buildSegments(content, keyword))).toBe(content)
  })

  it('分段顺序与原文位置一致（start 单调递增）', () => {
    const content = '见 https://a.com。及 foo'
    const segments = buildSegments(content, 'foo')
    let cursor = 0
    for (const segment of segments) {
      const index = content.indexOf(segment.text, cursor)
      expect(index).toBe(cursor)
      cursor += segment.text.length
    }
    expect(cursor).toBe(content.length)
  })
})
