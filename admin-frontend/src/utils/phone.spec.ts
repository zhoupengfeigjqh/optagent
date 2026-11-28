import { describe, expect, it } from 'vitest'
import { isPhone } from './phone'

describe('isPhone', () => {
  it('1 开头的 11 位数字通过（容忍首尾空白）', () => {
    expect(isPhone('13800000001')).toBe(true)
    expect(isPhone(' 13800000001 ')).toBe(true)
  })

  it('位数、开头与字符不对一律拒绝', () => {
    expect(isPhone('1380000000')).toBe(false)
    expect(isPhone('138000000012')).toBe(false)
    expect(isPhone('23800000001')).toBe(false)
    expect(isPhone('1380000000a')).toBe(false)
    expect(isPhone('')).toBe(false)
  })
})
