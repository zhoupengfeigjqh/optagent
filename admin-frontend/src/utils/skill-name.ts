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

export function skillHasAlias(item: SkillNameSource | null | undefined): boolean {
  if (!item) return false
  return skillDisplayName(item) !== item.name
}
