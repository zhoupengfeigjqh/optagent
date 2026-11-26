import { SOUL_LIMITS, type SoulDesign } from '../../src/domain/config-center/soul-design.js';

export function soulDesign(mission: string, extra: Partial<SoulDesign> = {}): SoulDesign {
  return {
    intro: '测试用简介',
    welcome: '测试用欢迎语',
    starters: [],
    mission,
    capability_tags: [],
    forbidden: [],
    prompt_extra: '',
    next_action_hints: false,
    next_action_hints_count: SOUL_LIMITS.nextActionHintsDefault,
    intent_focus: false,
    intent_focus_depth: SOUL_LIMITS.focusDepthDefault,
    input_rewrite: false,
    term_normalize: false,
    task_planning: false,
    ...extra,
  };
}

export function emptySoul(): SoulDesign {
  return soulDesign('', { intro: '', welcome: '' });
}
