/**
 * 结构化 SOUL 的测试夹具（004 / 007）。
 *
 * 结构化改造后，凡是构造数字人设计态的用例都需要一份**必填项齐全**的 soul
 * （`intro` / `welcome` / `mission`）。集中在这里，避免几十处各自拼一个对象、
 * 后续加必填字段时又要改一遍。
 *
 * **007 / 013**：`next_action_hints` 与 `intent_focus` 也放在这里并显式给 `false`——接口对外
 * **恒有这些键**（读取归一化会补），夹具与服务端形态一致，用例才能直接 `toEqual` 整个 soul。
 */
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
    ...extra,
  };
}

/** 空结构（用于"必填缺失"类用例） */
export function emptySoul(): SoulDesign {
  return soulDesign('', { intro: '', welcome: '' });
}
