import { describe, expect, it } from 'vitest'
import type { RegisterLinkItem } from '../api/types'
import { latestActiveLink, registerLinkState, sortRegisterLinks } from './register-link'

const NOW = new Date('2026-11-28T12:00:00').getTime()

function link(partial: Partial<RegisterLinkItem>): RegisterLinkItem {
  return {
    token: 'tok',
    agent_code: 'DH-DEMO01',
    agent_name: '演示',
    expires_at: null,
    revoked_at: null,
    use_count: 0,
    created_by: 'admin',
    created_at: '2026-11-27 10:00:00',
    ...partial,
  }
}

describe('registerLinkState', () => {
  it('未撤销且未过期 = 有效（有效期为空视为长期有效）', () => {
    expect(registerLinkState(link({}), NOW)).toBe('active')
  })

  it('撤销优先于过期', () => {
    expect(registerLinkState(link({ revoked_at: '2026-11-28 09:00:00' }), NOW)).toBe('revoked')
    expect(
      registerLinkState(
        link({ revoked_at: '2026-11-28 09:00:00', expires_at: '2026-11-01 00:00:00' }),
        NOW,
      ),
    ).toBe('revoked')
  })

  it('到点即过期', () => {
    expect(registerLinkState(link({ expires_at: '2026-11-28 11:59:59' }), NOW)).toBe('expired')
    expect(registerLinkState(link({ expires_at: '2026-11-28 12:00:01' }), NOW)).toBe('active')
  })
})

describe('sortRegisterLinks', () => {
  it('有效 → 过期 → 撤销，同状态按创建时间倒序', () => {
    const sorted = sortRegisterLinks(
      [
        link({ token: 'revoked', revoked_at: '2026-11-28 09:00:00' }),
        link({ token: 'expired', expires_at: '2026-11-01 00:00:00' }),
        link({ token: 'activeOld', created_at: '2026-11-20 10:00:00' }),
        link({ token: 'activeNew', created_at: '2026-11-27 10:00:00' }),
      ],
      NOW,
    )
    expect(sorted.map((item) => item.token)).toEqual(['activeNew', 'activeOld', 'expired', 'revoked'])
  })

  it('不改动入参顺序', () => {
    const input = [link({ token: 'b' }), link({ token: 'a' })]
    sortRegisterLinks(input, NOW)
    expect(input.map((item) => item.token)).toEqual(['b', 'a'])
  })
})

describe('latestActiveLink', () => {
  it('取最近生成的有效链接', () => {
    const latest = latestActiveLink(
      [
        link({ token: 'old', created_at: '2026-11-20 10:00:00' }),
        link({ token: 'new', created_at: '2026-11-27 10:00:00' }),
        link({ token: 'expired', expires_at: '2026-11-01 00:00:00' }),
      ],
      NOW,
    )
    expect(latest?.token).toBe('new')
  })

  it('没有有效链接时返回 null（含空列表）', () => {
    expect(latestActiveLink([], NOW)).toBeNull()
    expect(
      latestActiveLink([link({ revoked_at: '2026-11-28 09:00:00' })], NOW),
    ).toBeNull()
  })
})
