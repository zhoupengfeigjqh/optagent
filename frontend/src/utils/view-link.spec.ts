/**
 * 单测：产出正文的视图链接（`TR-41` / `TR-42`）。
 *
 * 两条不变式 MUST 断言（它们各自对应一个真实事故形态）：
 * 1. **已带前缀的值绝不被拼接**——否则会拼出 `http://本机/http://别处/…`；
 * 2. **无前缀拼出的 host 恰为注入的 origin**——用注入 origin，不依赖 jsdom 的真实 `location`。
 *
 * 拒绝形态一律返回 `null`（调用方按普通文本渲染）：`//host/…` 会被 `new URL` 换掉 host，
 * 无前导 `/` 的会相对当前路径解析，其它 scheme 是注入面。
 */
import { describe, expect, it } from 'vitest'

import {
  VIEW_LINK_ADDRESS_MAX_CHARS,
  VIEW_URL_FIELD,
  isViewUrlField,
  resolveViewUrl,
  toViewLinkEntries,
  truncateMiddle,
  viewLinkLabel,
  viewLinkTitle,
  type ViewLinkEntry,
} from './view-link'

const ORIGIN = 'http://192.168.0.100:8080'

describe('resolveViewUrl —— 已带前缀（原样，不拼接）', () => {
  it.each([
    'http://192.168.0.188:8080/datasource/dsdasds/dstsd/abc/xlsx',
    'https://example.com/report',
  ])('%s 原样返回', (raw) => {
    expect(resolveViewUrl(raw, ORIGIN)).toBe(raw)
  })

  it('协议大小写不敏感', () => {
    expect(resolveViewUrl('HTTP://Host:8080/x', ORIGIN)).toBe('HTTP://Host:8080/x')
    expect(resolveViewUrl('Https://Host/x', ORIGIN)).toBe('Https://Host/x')
  })
})

describe('resolveViewUrl —— 无前缀（拼当前入口）', () => {
  it('根相对路径拼出注入的 origin，且 host 与其相等', () => {
    const href = resolveViewUrl('/datasource/dsdasds/dstsd/abc/xlsx', ORIGIN)

    expect(href).toBe(`${ORIGIN}/datasource/dsdasds/dstsd/abc/xlsx`)
    expect(new URL(href as string).origin).toBe(ORIGIN)
  })

  it('带 query 与 fragment 时正确保留', () => {
    expect(resolveViewUrl('/a/b?x=1&y=2#z', ORIGIN)).toBe(`${ORIGIN}/a/b?x=1&y=2#z`)
  })

  it('中文路径按 URL 规则编码', () => {
    expect(resolveViewUrl('/结果/产能表', ORIGIN)).toBe(
      `${ORIGIN}/%E7%BB%93%E6%9E%9C/%E4%BA%A7%E8%83%BD%E8%A1%A8`,
    )
  })

  it('首尾空白被裁掉', () => {
    expect(resolveViewUrl('  /a/b  ', ORIGIN)).toBe(`${ORIGIN}/a/b`)
  })

  it('未注入 origin 时取当前页面入口', () => {
    // 显式断言"默认取 window.location.origin"，防止将来被改成写死值
    expect(resolveViewUrl('/a/b')).toBe(`${window.location.origin}/a/b`)
  })
})

describe('resolveViewUrl —— 拒绝（一律 null）', () => {
  it.each([
    ['协议相对 URL（host 会被换成对方）', '//evil.com/x'],
    ['无前导斜杠（会相对当前路径解析）', 'datasource/x'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,payload'],
    ['反斜杠', '/a\\b'],
    ['控制字符', '/a\u0000b'],
    ['空串', ''],
    ['全空白', '   '],
  ])('%s → null', (_name, raw) => {
    expect(resolveViewUrl(raw, ORIGIN)).toBeNull()
  })

  it('非字符串 → null', () => {
    expect(resolveViewUrl(123, ORIGIN)).toBeNull()
    expect(resolveViewUrl(null, ORIGIN)).toBeNull()
    expect(resolveViewUrl(undefined, ORIGIN)).toBeNull()
    expect(resolveViewUrl({ href: '/a' }, ORIGIN)).toBeNull()
    expect(resolveViewUrl(['/a'], ORIGIN)).toBeNull()
  })

  it('注入的 origin 不是合法基址 → null（不猜基址）', () => {
    expect(resolveViewUrl('/a', 'not-a-url')).toBeNull()
  })
})

describe('isViewUrlField —— 只按字段名判定', () => {
  it('字段名匹配（大小写与首尾空白不敏感）', () => {
    expect(VIEW_URL_FIELD).toBe('viewUrl')
    expect(isViewUrlField('viewUrl')).toBe(true)
    expect(isViewUrlField('ViewUrl')).toBe(true)
    expect(isViewUrlField(' viewurl ')).toBe(true)
  })

  it('其它字段名与非字符串不匹配', () => {
    expect(isViewUrlField('url')).toBe(false)
    expect(isViewUrlField('viewUrls')).toBe(false)
    expect(isViewUrlField('view_url')).toBe(false)
    expect(isViewUrlField(undefined)).toBe(false)
    expect(isViewUrlField(1)).toBe(false)
  })
})

describe('toViewLinkEntries —— 入口行派生（TR-45）', () => {
  it('归一化：单个 / 开头拼 origin、已带前缀原样、非法形态丢弃', () => {
    const entries = toViewLinkEntries(
      [
        { url: '/a/b' },
        { url: 'http://other:8080/x' },
        { url: '//evil.com/x' },
        { url: 'javascript:alert(1)' },
        { url: 'datasource/x' },
      ],
      ORIGIN,
    )

    expect(entries.map((entry) => entry.href)).toEqual([`${ORIGIN}/a/b`, 'http://other:8080/x'])
  })

  it('按 href 去重：原值不同但归一化后同一目标只留一项', () => {
    const entries = toViewLinkEntries(
      [{ url: '/a/b' }, { url: '  /a/b  ' }, { url: `${ORIGIN}/a/b` }],
      ORIGIN,
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]?.href).toBe(`${ORIGIN}/a/b`)
  })

  it('同一 href 重复：名称取**首个非空值**（首次没给名字、后面给了就用后面那个）', () => {
    const entries = toViewLinkEntries([{ url: '/a' }, { url: '/a', name: 'A 明细' }], ORIGIN)

    expect(entries).toEqual([{ href: `${ORIGIN}/a`, raw: '/a', name: 'A 明细' }])
  })

  it('同一 href 重复：首个已有名称则不被后面的覆盖（确定性）', () => {
    const entries = toViewLinkEntries(
      [
        { url: '/a', name: '首个名字' },
        { url: '/a', name: '后给的名字' },
      ],
      ORIGIN,
    )

    expect(entries[0]?.name).toBe('首个名字')
  })

  it('名称空白 / 非字符串 → 视同没给名字（不是空串）', () => {
    expect(toViewLinkEntries([{ url: '/a', name: '   ' }], ORIGIN)[0]?.name).toBeUndefined()
    expect(
      toViewLinkEntries([{ url: '/a', name: '  A 明细  ' }], ORIGIN)[0]?.name,
    ).toBe('A 明细')
  })

  it('raw 保留原值（去首尾空白），供无名称时显示与悬停核对', () => {
    expect(toViewLinkEntries([{ url: '  /a  ' }], ORIGIN)[0]?.raw).toBe('/a')
  })

  it('空输入与 undefined 都返回空数组（调用方无需判空）', () => {
    expect(toViewLinkEntries(undefined, ORIGIN)).toEqual([])
    expect(toViewLinkEntries([], ORIGIN)).toEqual([])
  })

  it('全部非法时不返回半成品（空数组 → 界面整行不渲染）', () => {
    expect(toViewLinkEntries([{ url: '//evil.com/x' }, { url: '' }], ORIGIN)).toEqual([])
  })
})

describe('入口文案（TR-46）', () => {
  const entry = (over: Partial<ViewLinkEntry> = {}): ViewLinkEntry => ({
    href: `${ORIGIN}/a/b`,
    raw: '/a/b',
    ...over,
  })

  it('有名称 → 显示名称；悬停给「名称 — 完整地址」', () => {
    const named = entry({ name: '一车间产能明细' })

    expect(viewLinkLabel(named)).toBe('一车间产能明细')
    expect(viewLinkTitle(named)).toBe(`一车间产能明细 — ${ORIGIN}/a/b`)
  })

  it('无名称 → 显示地址（中段省略，首尾都保留）；悬停给完整地址', () => {
    const raw = '/datasource/dsdasds/dstsd/abc/xlsx'
    const unnamed = entry({ raw, href: `${ORIGIN}${raw}` })
    const label = viewLinkLabel(unnamed)

    expect(label).toBe(truncateMiddle(raw, VIEW_LINK_ADDRESS_MAX_CHARS))
    expect(label).toContain('…')
    expect(label.startsWith('/datasource/')).toBe(true)
    expect(label.endsWith('abc/xlsx')).toBe(true)
    expect(viewLinkTitle(unnamed)).toBe(`${ORIGIN}${raw}`)
  })

  it('不推断名称、不编号占位：短地址原样显示（不出现"视图 1"之类）', () => {
    expect(viewLinkLabel(entry())).toBe('/a/b')
  })
})

describe('truncateMiddle —— 中段省略', () => {
  it('不超长时原样返回', () => {
    expect(truncateMiddle('/a/b', VIEW_LINK_ADDRESS_MAX_CHARS)).toBe('/a/b')
    expect(truncateMiddle('/a/b', 4)).toBe('/a/b')
  })

  it('超长时保留首尾、中间省略（尾部最有辨识度，不能被吃掉）', () => {
    const text = '/datasource/plan/ws1/xlsx-extra'
    const out = truncateMiddle(text, 12)

    expect(out).toHaveLength(12)
    expect(out).toContain('…')
    expect(out.startsWith(text.slice(0, 6))).toBe(true)
    expect(out.endsWith(text.slice(-5))).toBe(true)
  })

  it('maxChars ≤ 1 时不做省略（避免退化成空串或只剩省略号）', () => {
    expect(truncateMiddle('/abcdef', 1)).toBe('/abcdef')
    expect(truncateMiddle('/abcdef', 0)).toBe('/abcdef')
  })
})
