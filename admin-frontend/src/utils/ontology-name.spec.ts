/**
 * 单元测试：本体显示名（2026-10-17）。
 *
 * 守住 `{场景名}-{本体名}` 这一条口径与三级取值回落：
 * 响应派生字段 → `metadata` 的两个名字 → 目录名。
 */
import { describe, expect, it } from 'vitest'
import { ontologyDisplayName, ontologyNameOf, ontologyScenarioOf } from './ontology-name'

const META = {
  created_at: '2026-07-15 16:05:02',
  deployed_version: 'v1.0',
  scenario_name: '生产调度',
  scenario_id: 1,
  ontology_name: '原材料采购和库存',
  ontology_id: 1,
}

describe('ontologyDisplayName', () => {
  it('优先用响应里的派生字段：`{场景名}-{本体名}`', () => {
    expect(
      ontologyDisplayName({ scenario: '生产调度', name: '原材料采购和库存', metadata: META }),
    ).toBe('生产调度-原材料采购和库存')
  })

  it('派生字段缺失时回落到 metadata（存量实例 / 字段裁剪的响应）', () => {
    expect(ontologyDisplayName({ metadata: META })).toBe('生产调度-原材料采购和库存')
  })

  it('metadata 也缺时用目录名兜底本体名；场景缺失只显示本体名（不留悬空破折号）', () => {
    expect(ontologyDisplayName({ ontology_dir: '原材料采购和库存' })).toBe('原材料采购和库存')
    expect(ontologyDisplayName({ scenario: '生产调度' })).toBe('生产调度')
  })

  it('空对象 → 单个 `—`（不渲染出 `—-—`），空值/空白视为缺失', () => {
    expect(ontologyDisplayName({})).toBe('—')
    expect(ontologyDisplayName(null)).toBe('—')
    expect(ontologyDisplayName({ scenario: '  ', name: '' })).toBe('—')
  })
})

describe('ontologyScenarioOf / ontologyNameOf', () => {
  it('场景：scenario → metadata.scenario_name', () => {
    expect(ontologyScenarioOf({ scenario: '资源调度' })).toBe('资源调度')
    expect(ontologyScenarioOf({ metadata: META })).toBe('生产调度')
  })

  it('本体名：name → metadata.ontology_name → ontology_dir', () => {
    expect(ontologyNameOf({ name: 'A' })).toBe('A')
    expect(ontologyNameOf({ metadata: META })).toBe('原材料采购和库存')
    expect(ontologyNameOf({ ontology_dir: 'B' })).toBe('B')
  })
})
