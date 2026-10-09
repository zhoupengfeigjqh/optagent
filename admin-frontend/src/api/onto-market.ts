/**
 * 本体市场（optonto `.data/onto_market`）的类型定义 —— 与 `contracts/admin-api.md` §4.6 同映射。
 *
 * 独立成文件的原因：`api/types.ts` 触及 500 行门禁，本组类型随"本体市场导入"
 * 功能整体新增，就近安置（2026-10-02）。
 */

/** 技能来源：本体市场导入的技能带溯源信息与内容指纹；缺省 = 外部安装（ZIP 上传等） */
export interface SkillOrigin {
  kind: 'onto_market'
  scenario: string
  ontology: string
  /** 导入时的整包内容指纹：与市场现算哈希对比即知"市场文件是否变化" */
  hash: string
}

export type OntoMarketSkillStatus = 'new' | 'unchanged' | 'changed' | 'conflict' | 'invalid'

/** 本体市场里的一份技能（`GET /api/admin/skills/onto-market`，平台对市场只读） */
export interface OntoMarketItem {
  scenario: string
  ontology: string
  /** `skills/` 下的技能目录名（导入请求的 skill 参数） */
  skill_dir: string
  name: string | null
  description: string | null
  /** 市场侧文件格式无效时的可读原因；非 null 不可导入 */
  invalid_reason: string | null
  files: Array<{ path: string; size: number }>
  /** 整包内容指纹（与库内 `origin.hash` 比对即知"市场文件是否变化"） */
  hash: string
  status: OntoMarketSkillStatus
}

export interface OntoMarketListing {
  /** 是否配置了 ONTO_MARKET_DIR；false = 功能不可用（reason 给出原因） */
  configured: boolean
  reason: string | null
  items: OntoMarketItem[]
}

/** 本体市场更新结果（§4.8）：安装结果 + 传播面信息 */
export interface OntoMarketUpdateResult {
  name: string
  description: string
  files: Array<{ path: string; size: number }>
  /** 首次导入时间（更新不改变它） */
  installed_at: string
  overwritten: true
  /** 更新前库内内容与导入时不一致（本次丢弃了人工修改） */
  locally_modified: boolean
  /** 设计时引用该技能的数字人：需重新部署才会拿到新副本 */
  affected_agents: string[]
}
