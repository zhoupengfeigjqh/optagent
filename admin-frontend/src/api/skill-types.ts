/**
 * SKILL 管理相关类型（`contracts/admin-api.md` §4.1~§4.5，含 §4.8 的市场更新）。
 *
 * 独立成文件的原因与 `api/onto-market.ts` 同：`api/types.ts` 触及 500 行硬门禁（原则二）。
 * `api/types.ts` 仍**再导出**本文件的类型，既有引用方（组件与测试一律从 `api/types` 取）
 * 无需改动。
 *
 * 2026-10-03：`origin` 为市场来源标记；`origin.kind === 'onto_market'` 的技能**只读**
 * （`FR-062`），界面因此不渲染编辑入口。
 */
import type { SkillOrigin } from './onto-market'

export interface SkillListItem {
  name: string
  description: string
  installed_at: string
  updated_at: string
  source: string
  /** 来源标记；缺省 = 外部安装（ZIP 上传等，可在线编辑） */
  origin?: SkillOrigin | null
}

export interface SkillDetail {
  name: string
  description: string
  content: string
  /** `SKILL.md` 的内容哈希：详情页直接改正文时的乐观锁基准 */
  content_hash: string
  files: Array<{ path: string; size: number }>
  source: string
  /**
   * 来源标记：`onto_market` = 从本体市场导入（**只读**，2026-10-03 起；
   * 内容只能经「从本体市场导入」的更新整体替换，见 `FR-062`）；缺省 = 外部安装（ZIP 等）。
   */
  origin?: SkillOrigin | null
  installed_at: string
  updated_at: string
  revision: number
}

/** 技能内单个文件的内容（`GET /api/admin/skills/{name}/file`） */
export interface SkillFileContent {
  name: string
  path: string
  size: number
  /** 二进制文件：`content` 为 null，界面只提示大小 */
  binary: boolean
  /** 超出上限（256KB）时为 true，`content` 只含前 256KB */
  truncated: boolean
  content: string | null
  /** 内容哈希：保存时作为乐观锁基准原样回传 */
  hash: string
  /** 是否可在线编辑：文本且完整（二进制、超 256KB 均为 false，界面不给编辑入口） */
  editable: boolean
}

/** 保存技能内单个文件的结果（`PUT /api/admin/skills/{name}/file`） */
export interface SkillFileSaved {
  name: string
  path: string
  size: number
  /** 保存后的**新**哈希：界面据此更新内部基准，可连续编辑 */
  hash: string
  updated_at: string
  revision: number
}

export interface SkillInstallResult {
  name: string
  description: string
  files: Array<{ path: string; size: number }>
  installed_at: string
  overwritten: boolean
}
