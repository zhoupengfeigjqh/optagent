/**
 * SKILL 来源路径（2026-11-04）：`{场景} / {本体}`。
 *
 * 口径：**只有本体市场导入的技能有来源路径**（记录上的 `origin`）；
 * ZIP 上传 / 平台编辑等外部安装没有定位信息 → 返回空串，界面整行不渲染
 * （需求原话：「SKILL 安装产生的，可以没有来源」）。
 *
 * 与「从本体市场导入」弹窗里的 `{scenario} / {ontology}` 同格式（原则二：
 * 同一判据不留第二份实现）。
 */
import type { SkillOrigin } from '../api/onto-market'

export interface SkillSourceSource {
  origin?: SkillOrigin | null
}

/** 来源路径：本体市场导入 → `{场景} / {本体}`；其他来源 → 空串（整行不渲染） */
export function skillSourcePath(item: SkillSourceSource | null | undefined): string {
  const origin = item?.origin
  if (!origin || origin.kind !== 'onto_market') return ''
  return `${origin.scenario} / ${origin.ontology}`
}
