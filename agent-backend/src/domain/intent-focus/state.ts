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

const MIN_STATE_AFTER_BREAK = 24;

const SENTENCE_BREAK = /[。！？；!?;\n]/;

export type IntentFocusDisposition = 'focused' | 'empty' | 'skipped' | 'degraded' | 'unconfigured';

export interface PreparedState {
  state: string;
  truncated: boolean;
}

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
  // 先按 UTF-16 长度做零成本快判；超长时才按**码点**切，避免把 emoji 的代理对切成半个
  if (input.length <= MAX_STATE_CHARS) return { state: input, truncated: false };
  const chars = Array.from(input);
  if (chars.length <= MAX_STATE_CHARS) return { state: input, truncated: false };
  const tail = chars.slice(-MAX_STATE_CHARS).join('');
  const match = SENTENCE_BREAK.exec(tail);
  if (match && tail.length - (match.index + 1) >= MIN_STATE_AFTER_BREAK) {
    return { state: tail.slice(match.index + 1).trim(), truncated: true };
  }
  return { state: tail, truncated: true };
}

export type DispositionInput =
  | { kind: 'disabled' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'unconfigured'; reason: string }
  | { kind: 'failed'; reason: string }
  | {
      kind: 'ok';
      skillCount: number;
      focusableCount: number;
      selectedCount: number;
    };

export const EMPTY_REASON = {
  noSkills: 'no_skills',
  noFocusableSkills: 'no_focusable_skills',
  belowThreshold: 'below_threshold',
} as const;

export interface DispositionResult {
  disposition: IntentFocusDisposition;
  reason: string | null;
}

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
      if (input.skillCount === 0) return { disposition: 'empty', reason: EMPTY_REASON.noSkills };
      if (input.focusableCount === 0) {
        return { disposition: 'empty', reason: EMPTY_REASON.noFocusableSkills };
      }
      if (input.selectedCount === 0) {
        return { disposition: 'empty', reason: EMPTY_REASON.belowThreshold };
      }
      return { disposition: 'focused', reason: null };
  }
}
