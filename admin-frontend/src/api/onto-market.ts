
export interface SkillOrigin {
  kind: 'onto_market'
  scenario: string
  ontology: string
  hash: string
}

export type OntoMarketSkillStatus = 'new' | 'unchanged' | 'changed' | 'conflict' | 'invalid'

export interface OntoMarketItem {
  scenario: string
  ontology: string
  skill_dir: string
  name: string | null
  display_name?: string | null
  description: string | null
  /** 市场侧文件格式无效时的可读原因；非 null 不可导入 */
  invalid_reason: string | null
  files: Array<{ path: string; size: number }>
  hash: string
  status: OntoMarketSkillStatus
}

export interface OntoMarketListing {
  /** 是否配置了 ONTO_MARKET_DIR；false = 功能不可用（reason 给出原因） */
  configured: boolean
  reason: string | null
  items: OntoMarketItem[]
}

export interface OntoMarketUpdateResult {
  name: string
  display_name?: string | null
  description: string
  files: Array<{ path: string; size: number }>
  installed_at: string
  overwritten: true
  locally_modified: boolean
  affected_agents: string[]
}
