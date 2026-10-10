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

import { VIEW_URL_FIELD, isViewUrlField, resolveViewUrl } from './view-link'

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
