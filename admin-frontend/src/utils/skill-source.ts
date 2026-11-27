import type { SkillOrigin } from '../api/onto-market'

export interface SkillSourceSource {
  origin?: SkillOrigin | null
}

export function skillSourcePath(item: SkillSourceSource | null | undefined): string {
  const origin = item?.origin
  if (!origin || origin.kind !== 'onto_market') return ''
  return `${origin.scenario} / ${origin.ontology}`
}
