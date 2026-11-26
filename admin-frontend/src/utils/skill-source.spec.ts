import { describe, expect, it } from 'vitest'
import { skillSourcePath } from './skill-source'

describe('skillSourcePath', () => {
  it('本体市场来源 → 场景 / 本体', () => {
    expect(
      skillSourcePath({
        origin: {
          kind: 'onto_market',
          scenario: '生产调度',
          ontology: '原材料采购和库存',
          hash: 'h1',
        },
      }),
    ).toBe('生产调度 / 原材料采购和库存')
  })

  it('外部安装（无 origin / null）→ 空串', () => {
    expect(skillSourcePath({})).toBe('')
    expect(skillSourcePath({ origin: null })).toBe('')
    expect(skillSourcePath(null)).toBe('')
    expect(skillSourcePath(undefined)).toBe('')
  })
})
