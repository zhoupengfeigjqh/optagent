/**
 * `/技能名` 在输入区的落字与按键路由（2026-11-07）
 *
 * 与 `useMentionComposer` 同构、同纪律：落字只由 `skillToken` 决定，剥离只由
 * `stripSkillToken` 决定；本文件只做"触发片段 → 完整标记"的替换与按键转发。
 *
 * 单选语义：选择新技能时先移除旧标记，再落新标记（一条消息只允许一个技能）。
 */
import { type Ref } from 'vue'

import {
  SKILL_TRIGGER_PATTERN,
  skillToken,
  stripSkillToken,
  type SkillMentionStore,
} from './useSkillMention'

/** 创建参数。 */
export interface SkillComposerDeps {
  skill: SkillMentionStore
  draft: Ref<string>
}

/** 输入区侧 `/技能名` 接线。 */
export interface SkillComposer {
  /** 文本/光标变化：检测 `/` 触发并同步选择 */
  onInputText(payload: { value: string; caret: number }): void
  /** 选择技能：替换触发片段为完整标记 */
  onPickSkill(name: string): void
  /** Enter/→ 确认当前高亮项 */
  onConfirmSkill(): void
  /** `/` 面板展开时的按键路由（Composer 已拦截并 preventDefault） */
  onSkillKey(key: string): void
  /** 点胶囊 x：移除选择并删除正文标记 */
  onRemoveSkill(): void
}

/** 用完整标记替换触发片段（`…/supp` → `…/supplier-query `）。 */
function replaceTrigger(text: string, token: string): string {
  if (!SKILL_TRIGGER_PATTERN.test(text)) {
    // 触发片段已被删掉（选择与文本短暂不同步）：退化为"在末尾补一个标记"
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
    // 单选：先记下旧选择（`pick` 会把 `selected` 改成新值），清旧标记再落新标记
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
        // 关闭面板但不丢文本
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
