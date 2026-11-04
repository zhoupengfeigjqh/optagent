/**
 * 单元测试：SKILL 展示名（2026-11-04）
 *
 * 守住两条口径：
 * 1. `display_name` 非空即用它，缺失/空串/纯空白回落 `name`（旧索引与旧夹具也要能渲染）；
 * 2. 展示名与身份名不同才需要补小字 `name`——相同则不渲染重复行。
 */
import { describe, expect, it } from 'vitest'
import { skillDisplayName, skillHasAlias } from './skill-name'

describe('skillDisplayName', () => {
  it('display_name 非空 → 用展示名', () => {
    expect(skillDisplayName({ name: 'pdf-parse', display_name: '文档解析' })).toBe('文档解析')
  })

  it('缺失 / 空串 / 纯空白 / null → 回落 name', () => {
    expect(skillDisplayName({ name: 'pdf-parse' })).toBe('pdf-parse')
    expect(skillDisplayName({ name: 'pdf-parse', display_name: '' })).toBe('pdf-parse')
    expect(skillDisplayName({ name: 'pdf-parse', display_name: '   ' })).toBe('pdf-parse')
    expect(skillDisplayName({ name: 'pdf-parse', display_name: null })).toBe('pdf-parse')
  })

  it('空项 → 空串（首次渲染不抛错）', () => {
    expect(skillDisplayName(null)).toBe('')
    expect(skillDisplayName(undefined)).toBe('')
  })
})

describe('skillHasAlias', () => {
  it('展示名与身份名不同 → true', () => {
    expect(skillHasAlias({ name: 'pdf-parse', display_name: '文档解析' })).toBe(true)
  })

  it('相同或缺展示名 → false（不渲染重复小字）', () => {
    expect(skillHasAlias({ name: 'pdf-parse', display_name: 'pdf-parse' })).toBe(false)
    expect(skillHasAlias({ name: 'pdf-parse' })).toBe(false)
    expect(skillHasAlias(null)).toBe(false)
  })
})
