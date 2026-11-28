import { describe, expect, it } from 'vitest'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordError } from './password'

describe('passwordError', () => {
  it('界内（含上下界）通过', () => {
    expect(passwordError('a'.repeat(PASSWORD_MIN_LENGTH))).toBeNull()
    expect(passwordError('a'.repeat(PASSWORD_MAX_LENGTH))).toBeNull()
    expect(passwordError('123456')).toBeNull()
  })

  it('过短 / 过长给出与后端同口径的提示', () => {
    expect(passwordError('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe('密码长度须为 6~128 个字符')
    expect(passwordError('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toBe('密码长度须为 6~128 个字符')
    expect(passwordError('')).toBe('密码长度须为 6~128 个字符')
  })
})
