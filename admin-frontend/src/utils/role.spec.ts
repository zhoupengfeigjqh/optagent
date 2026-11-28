import { describe, expect, it } from 'vitest'
import { isAdminRole } from './role'

describe('isAdminRole', () => {
  it('仅 admin 为真', () => {
    expect(isAdminRole('admin')).toBe(true)
    expect(isAdminRole('user')).toBe(false)
  })

  it('缺省与非字符串值一律按非管理员处理', () => {
    expect(isAdminRole(null)).toBe(false)
    expect(isAdminRole(undefined)).toBe(false)
    expect(isAdminRole('')).toBe(false)
    expect(isAdminRole('Admin')).toBe(false)
  })
})
