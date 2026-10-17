/**
 * 本体显示名（2026-10-17）：`{场景名}-{本体名}`。
 *
 * 本体身份就是这两段（同一本体名可存在于不同场景），只显示本体名会把两条记录
 * 渲染成同一条。卡片标题、详情页标题、删除确认与全局播报共用这一份实现
 * （原则二：同一判据不留第二份）。
 *
 * **身份只有 `metadata` 一份来源**：库内记录、详情、导入结果都不再带
 * `scenario` / `ontology_dir` / `name` / `source` 副本字段。这里仍接受这几个字段，
 * 是因为**本体市场条目**（`§10.4`）本来就以两级目录名为主键，同一套取名逻辑可以
 * 直接复用在市场列表上。
 */
import type { OntologyMetadata } from '../api/ontologies'

/** 参与取名的字段：列表项 / 详情 / 导入结果都满足的最小形状 */
export interface OntologyNameSource {
  scenario?: string | null
  name?: string | null
  ontology_dir?: string | null
  metadata?: OntologyMetadata | null
}

function firstText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return ''
}

/** 场景名：`scenario` → `metadata.scenario_name`（都取不到为空串） */
export function ontologyScenarioOf(item: OntologyNameSource | null | undefined): string {
  if (!item) return ''
  return firstText(item.scenario, item.metadata?.scenario_name)
}

/** 本体名：`name` → `metadata.ontology_name` → `ontology_dir`（都取不到为空串） */
export function ontologyNameOf(item: OntologyNameSource | null | undefined): string {
  if (!item) return ''
  return firstText(item.name, item.metadata?.ontology_name, item.ontology_dir)
}

/**
 * 显示名：`{场景名}-{本体名}`。
 *
 * 单段缺失时只显示存在的那一段（不留 `—-本体` 这种破折号悬空）；
 * 两段都缺失才是 `—`（脏数据 / 首次渲染）。
 */
export function ontologyDisplayName(item: OntologyNameSource | null | undefined): string {
  const scenario = ontologyScenarioOf(item)
  const name = ontologyNameOf(item)
  if (scenario === '') return name === '' ? '—' : name
  if (name === '') return scenario
  return `${scenario}-${name}`
}
