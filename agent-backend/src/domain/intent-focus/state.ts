/**
 * 意图聚焦（016）纯逻辑：输入截断 → 处置判定。
 *
 * 候选构造 / 题面 / 选择 / 提示铸造分别在**同目录**其余模块，本文件只保留
 * **与业务无关的公共口径**：阈值不在这里归一（区间校验由 `config.ts` 唯一承担），
 * 处置结论也不在 runner 里另写一套字面量。
 *
 * 本文件 MUST 保持纯函数（无 IO、无时钟、无随机）：同输入必得同输出。
 */
import type { SystemOneQuestion } from '../../infra/laya-client.js';

/**
 * 单批题数上限。
 *
 * Laya 对**单题**有 `max_question_tokens = 256`、对**整条序列**有
 * `max_sequence_tokens = 1024`，但对题数没有硬上限。这个值只承担两件事：
 * 单请求体大小可控、降级粒度可控——与判定精度无关（013 实测切批前后分数逐位相同）。
 */
export const MAX_QUESTIONS_PER_BATCH = 32;

/**
 * 送入判定的本轮输入字符上限。
 *
 * 实测：中文 1800 字 ≈ 999 token（通过），2200 字触发 422 `too_long`；
 * 取 200 是保守值（题数越多、state 越长，总 prefill 越大）。
 */
export const MAX_STATE_CHARS = 200;

/** 对齐句首后的最短保留长度：太短说明切过头了，宁可不切 */
const MIN_STATE_AFTER_BREAK = 24;

/** 句末标点/换行：用于把截断点对齐到句首 */
const SENTENCE_BREAK = /[。！？；!?;\n]/;

/** 处置结论（与 `data-model.md §7.1` 一致，共 5 态） */
export type IntentFocusDisposition = 'focused' | 'empty' | 'skipped' | 'degraded' | 'unconfigured';

/** 送入模型的输入（超长截断） */
export interface PreparedState {
  state: string;
  truncated: boolean;
}

/** 一批命题（键 = `qid`） */
export interface QuestionBatch {
  questions: Record<string, SystemOneQuestion>;
}

/**
 * 截断本轮输入，便于留档标注"已截断"。
 *
 * **取尾部**（不是取头部）：用户粘贴长材料的习惯是"材料在前、问题在后"，
 * 取头会把唯一的问题截掉，判定只能看到一堆无关正文。
 * 截断点尽量对齐到句首，避免从词中间切开。
 */
export function prepareState(input: string): PreparedState {
  if (input.length <= MAX_STATE_CHARS) return { state: input, truncated: false };
  const tail = input.slice(-MAX_STATE_CHARS);
  const match = SENTENCE_BREAK.exec(tail);
  if (match && tail.length - (match.index + 1) >= MIN_STATE_AFTER_BREAK) {
    return { state: tail.slice(match.index + 1).trim(), truncated: true };
  }
  return { state: tail, truncated: true };
}

/** 处置判定入参 */
export type DispositionInput =
  | { kind: 'disabled' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'unconfigured'; reason: string }
  | { kind: 'failed'; reason: string }
  | {
      kind: 'ok';
      /** 本轮发现的技能文件数（含未匹配本体的本体技能） */
      skillCount: number;
      /** 可聚焦技能数（非本体 + 已匹配本体） */
      focusableCount: number;
      /** 入选技能数 */
      selectedCount: number;
    };

/** 判定结论（唯一形态：处置 + 原因） */
export interface DispositionResult {
  disposition: IntentFocusDisposition;
  reason: string | null;
}

/**
 * 处置判定（唯一实现）。
 *
 * 重载让"开关关闭就没有结论"由**类型**表达：`disabled` 恒为 `null`（关闭轮次不留档，
 * FR-060），其余四类恒有结论——调用方因此不必写永远走不到另一侧的防御分支。
 */
export function decideDisposition(input: { kind: 'disabled' }): null;
export function decideDisposition(
  input: Exclude<DispositionInput, { kind: 'disabled' }>,
): DispositionResult;
export function decideDisposition(input: DispositionInput): DispositionResult | null {
  switch (input.kind) {
    case 'disabled':
      return null;
    case 'skipped':
      return { disposition: 'skipped', reason: input.reason };
    case 'unconfigured':
      return { disposition: 'unconfigured', reason: input.reason };
    case 'failed':
      return { disposition: 'degraded', reason: input.reason };
    case 'ok':
      if (input.skillCount === 0) return { disposition: 'empty', reason: 'no_skills' };
      if (input.focusableCount === 0) return { disposition: 'empty', reason: 'no_focusable_skills' };
      if (input.selectedCount === 0) return { disposition: 'empty', reason: 'below_threshold' };
      return { disposition: 'focused', reason: null };
  }
}
