import { type Ref } from 'vue'

import {
  SKILL_TRIGGER_PATTERN,
  skillToken,
  stripSkillToken,
  type SkillMentionStore,
} from './useSkillMention'

export interface SkillComposerDeps {
  skill: SkillMentionStore
  draft: Ref<string>
}

export interface SkillComposer {
  onInputText(payload: { value: string; caret: number }): void
  onPickSkill(name: string): void
  onConfirmSkill(): void
  onSkillKey(key: string): void
  onRemoveSkill(): void
}

function replaceTrigger(text: string, token: string): string {
  if (!SKILL_TRIGGER_PATTERN.test(text)) {
    const separator = text === '' || /\s$/.test(text) ? '' : ' '
    return `${text}${separator}${token} `
  }
  return `${text.replace(/(^|\s)\/[^\s/]*$/, '$1')}${token} `
}

export function useSkillComposer(deps: SkillComposerDeps): SkillComposer {
  const { skill, draft } = deps

  function onInputText(payload: { value: string; caret: number }): void {
    skill.handleInput(payload.value, payload.caret)
  }

  function onPickSkill(name: string): void {
    const previous = skill.selected.value
    if (!skill.pick(name)) return
    const base = previous ? stripSkillToken(draft.value, previous) : draft.value
    draft.value = replaceTrigger(base, skillToken(name))
  }

  function onConfirmSkill(): void {
    const name = skill.confirmActive()
    if (name) onPickSkill(name)
  }

  function onSkillKey(key: string): void {
    switch (key) {
      case 'ArrowDown':
        skill.move(1)
        break
      case 'ArrowUp':
        skill.move(-1)
        break
      case 'ArrowRight':
      case 'Enter':
        onConfirmSkill()
        break
      case 'Escape':
        skill.close()
        break
      default:
        break
    }
  }

  function onRemoveSkill(): void {
    const name = skill.selected.value
    skill.remove()
    if (name) draft.value = stripSkillToken(draft.value, name)
  }

  return { onInputText, onPickSkill, onConfirmSkill, onSkillKey, onRemoveSkill }
}
