import { stripSkillToken } from '../composables/useSkillMention'

export function canSendContent(
  text: string,
  skill: string | null,
  referenceCount: number,
): boolean {
  if (referenceCount > 0) return true
  return stripSkillToken(text, skill).trim() !== ''
}
