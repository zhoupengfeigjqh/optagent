/**
 * 结构化 SOUL 的测试夹具（004）。
 *
 * 结构化改造后，凡是构造数字人设计态的用例都需要一份**必填项齐全**的 soul
 * （`intro` / `welcome` / `mission`）。集中在这里，避免几十处各自拼一个对象、
 * 后续加必填字段时又要改一遍。
 */
import type { SoulDesign } from '../../src/domain/config-center/soul-design.js';

export function soulDesign(mission: string, extra: Partial<SoulDesign> = {}): SoulDesign {
  return {
    intro: '测试用简介',
    welcome: '测试用欢迎语',
    starters: [],
    mission,
    capability_tags: [],
    forbidden: [],
    prompt_extra: '',
    ...extra,
  };
}

/** 空结构（用于"必填缺失"类用例） */
export function emptySoul(): SoulDesign {
  return soulDesign('', { intro: '', welcome: '' });
}
