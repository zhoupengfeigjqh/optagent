/**
 * SKILL 展示名（2026-11-04）：`display_name` → `name`。
 *
 * 后端在导入/保存 `SKILL.md` 时已按 `metadata.name` → `title` → `ontology_name` →
 * `display_name` → 顶层 `name` 的优先级算好 `display_name`；这里只做"字段缺失/空串"
 * 的兜底，让旧索引与旧测试夹具也能正常渲染。
 *
 * **只用于展示**：`name` 是技能的身份（技能库目录名、数字人引用键、接口路径参数），
 * 请求、事件与路由参数 MUST 继续传 `name`——把展示名当身份会打断引用（原则二）。
 */
export interface SkillNameSource {
  name: string
  display_name?: string | null
}

/** 展示名：`display_name` 非空则用它，否则回落 `name` */
export function skillDisplayName(item: SkillNameSource | null | undefined): string {
  if (!item) return ''
  const display = item.display_name
  if (typeof display === 'string' && display.trim() !== '') return display
  return item.name
}

/** 展示名与身份名不同 → 界面在标题下方补一行小字 `name`（两者相同不重复渲染） */
export function skillHasAlias(item: SkillNameSource | null | undefined): boolean {
  if (!item) return false
  return skillDisplayName(item) !== item.name
}
