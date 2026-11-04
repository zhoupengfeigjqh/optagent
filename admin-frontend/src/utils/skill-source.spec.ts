/**
 * 单元测试：SKILL 来源路径（2026-11-04）
 *
 * 口径：只有本体市场导入的技能有来源路径（`{场景} / {本体}`）；
 * ZIP 等外部安装没有定位信息 → 空串，界面整行不渲染。
 */
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
