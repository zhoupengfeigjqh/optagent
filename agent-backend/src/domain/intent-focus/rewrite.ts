import type { IntentFocusConfig } from '../../config.js';
import type { ModelSelection } from '../../types.js';
import type { DecideClient } from './batch-decider.js';
import type { RewriteFocusRecord } from './store.js';
import {
  NEED_REWRITE_QID,
  REWRITE_SYSTEM_PROMPT,
  buildNeedRewriteQuestion,
  buildRewriteMessages,
  normalizeRewrite,
  pickRecentTurns,
  shouldRewrite,
  type RewriteHistoryMessage,
} from './rewrite-prompt.js';
import { prepareState } from './state.js';

/**
 * 阶段推进所需的最小剩余预算（毫秒）。
 *
 * 低于它就**不发起**改写：一次改写要经过模型首字 + 生成，300ms 连排队都不够，
 * 发出去只会变成"用户多等 300ms 然后还是原文"——不如立刻回退。
 */
export const MIN_REWRITE_BUDGET_MS = 300;

/** 改写超时的安全余量：不能把阶段预算吃干净，否则后续技能评分必然超时 */
export const REWRITE_BUDGET_MARGIN_MS = 100;

export interface RewriteLlmRequest {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: ModelSelection;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface RewriteLlm {
  complete(req: RewriteLlmRequest): Promise<string>;
}

export type ReadHistory = (
  userId: string,
  agentName: string,
  threadId: string,
) => ReadonlyArray<RewriteHistoryMessage>;

export type RewriteReason =
  | 'judge_failed'
  | 'below_threshold'
  | 'llm_failed'
  | 'empty_output'
  | 'budget_exhausted'
  | 'no_history';

export interface RewriteOutcome {
  state: string;
  truncated: boolean;
  origin: 'rewrite' | 'original';
  needRewrite: boolean | null;
  score: number | null;
  rewrite: string;
  rewriteTruncated: boolean;
  rewriteMs: number | null;
  historyTurns: number;
  /**
   * 说明性原因：`null` = 未执行或"改写成功且素材完整"。
   *
   * `below_threshold` / `no_history` 都**不是失败**——与"失败"的区别在于
   * 是否有降级日志事件；记录里靠 `need_rewrite` 与 `rewrite_query` 判定实际结果。
   */
  reason: RewriteReason | null;
}

export interface RewriteStageLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface RewriteStageDeps {
  config: IntentFocusConfig;
  enabled: boolean;
  /** Laya 判定客户端；缺省 = 判定不可用（按判定失败降级） */
  client?: DecideClient;
  /** 缺省 = 改写不可用（本轮按原文聚焦，零副作用） */
  rewriteLlm?: RewriteLlm;
  readHistory?: ReadHistory;
  logger?: RewriteStageLogger;
  now?: () => number;
}

export interface RewriteStageInput {
  userId: string;
  agentName: string;
  threadId: string;
  userInput: string;
  /** 意图聚焦阶段的总截止时间（毫秒时间戳） */
  deadline: number;
  model?: ModelSelection;
  signal?: AbortSignal;
}

export async function runRewriteStage(
  deps: RewriteStageDeps,
  input: RewriteStageInput,
): Promise<RewriteOutcome> {
  const now = deps.now ?? Date.now;
  const prepared = prepareState(input.userInput);
  const original = (): RewriteOutcome => ({
    state: prepared.state,
    truncated: prepared.truncated,
    origin: 'original',
    needRewrite: null,
    score: null,
    rewrite: '',
    rewriteTruncated: false,
    rewriteMs: null,
    historyTurns: 0,
    reason: null,
  });

  if (!deps.enabled) {
    logSkipped(deps, input, 'switch_off');
    return original();
  }

  if (!deps.client || !deps.rewriteLlm) {
    logSkipped(deps, input, 'switch_off');
    return original();
  }

  // 2. 指代判定：单条 noul，超时取"整轮剩余预算"与配置上限的较小者
  const judgeTimeoutMs = Math.min(
    deps.config.timeoutMs,
    Math.max(MIN_REWRITE_BUDGET_MS, input.deadline - now()),
  );
  let decided: Awaited<ReturnType<DecideClient['decide']>>;
  try {
    decided = await deps.client.decide(
      prepared.state,
      { [NEED_REWRITE_QID]: buildNeedRewriteQuestion() },
      judgeTimeoutMs,
    );
  } catch (err) {
    decided = { ok: false, reason: 'network', message: errorMessage(err) };
  }

  const score = decided.ok ? decided.scores[NEED_REWRITE_QID] : undefined;
  if (!decided.ok || typeof score !== 'number' || !Number.isFinite(score)) {
    logDegraded(deps, input, 'judge', 'judge_failed', decided.ok ? '响应缺少该题分数' : decided.message);
    return { ...original(), reason: 'judge_failed' };
  }

  if (!shouldRewrite(score, deps.config.rewriteThreshold)) {
    logDone(deps, input, { score, needRewrite: false, historyTurns: 0, chars: 0, truncated: false, ms: null });
    return { ...original(), needRewrite: false, score, reason: 'below_threshold' };
  }

  const remaining = input.deadline - now();
  if (remaining < MIN_REWRITE_BUDGET_MS) {
    logSkipped(deps, input, 'budget_exhausted');
    return { ...original(), needRewrite: true, score, reason: 'budget_exhausted' };
  }

  let turns = [] as ReturnType<typeof pickRecentTurns>;
  if (deps.readHistory) {
    try {
      turns = pickRecentTurns(deps.readHistory(input.userId, input.agentName, input.threadId));
    } catch (err) {
      logDegraded(deps, input, 'rewrite', 'history_failed', errorMessage(err));
      turns = [];
    }
  }

  const timeoutMs = Math.max(
    1,
    Math.min(deps.config.rewriteTimeoutMs, remaining - REWRITE_BUDGET_MARGIN_MS),
  );
  const startedAt = now();
  let raw: string;
  try {
    raw = await deps.rewriteLlm.complete({
      systemPrompt: REWRITE_SYSTEM_PROMPT,
      messages: buildRewriteMessages(turns, input.userInput),
      ...(input.model ? { model: input.model } : {}),
      timeoutMs,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (err) {
    const ms = now() - startedAt;
    logDegraded(deps, input, 'rewrite', 'llm_failed', errorMessage(err));
    return {
      ...original(),
      needRewrite: true,
      score,
      rewriteMs: ms,
      historyTurns: turns.length,
      reason: 'llm_failed',
    };
  }

  const ms = now() - startedAt;
  const normalized = normalizeRewrite(raw);
  if (normalized.text === '') {
    logDegraded(deps, input, 'rewrite', 'empty_output', '改写结果归一化后为空');
    return {
      ...original(),
      needRewrite: true,
      score,
      rewriteMs: ms,
      historyTurns: turns.length,
      reason: 'empty_output',
    };
  }

  const reason: RewriteReason | null = turns.length === 0 ? 'no_history' : null;
  logDone(deps, input, {
    score,
    needRewrite: true,
    historyTurns: turns.length,
    chars: Array.from(normalized.text).length,
    truncated: normalized.truncated,
    ms,
  });
  return {
    state: normalized.text,
    truncated: false,
    origin: 'rewrite',
    needRewrite: true,
    score,
    rewrite: normalized.text,
    rewriteTruncated: normalized.truncated,
    rewriteMs: ms,
    historyTurns: turns.length,
    reason,
  };
}

/**
 * 把阶段产出映射成留档字段（**唯一映射点**）。
 *
 * 放在这里而不是 runner：字段名是契约的一部分，`RewriteOutcome` 改名时
 * 编译期就能发现漏改（`RewriteFocusRecord` 的键必须全给）。
 */
export function toRewriteRecordFields(outcome: RewriteOutcome): Required<RewriteFocusRecord> {
  return {
    need_rewrite: outcome.needRewrite,
    rewrite_score: outcome.score,
    rewrite_query: outcome.rewrite,
    rewrite_truncated: outcome.rewriteTruncated,
    rewrite_ms: outcome.rewriteMs,
    rewrite_history_turns: outcome.historyTurns,
    rewrite_reason: outcome.reason,
  };
}

/* ---------- 结构化日志（字段口径见契约 §9；禁止记录用户原文与改写全文） ---------- */

function logDone(
  deps: RewriteStageDeps,
  input: RewriteStageInput,
  fields: {
    score: number;
    needRewrite: boolean;
    historyTurns: number;
    chars: number;
    truncated: boolean;
    ms: number | null;
  },
): void {
  deps.logger?.info(
    {
      event: 'intent-focus.rewrite.done',
      thread_id: input.threadId,
      agent_name: input.agentName,
      need_rewrite: fields.needRewrite,
      score: fields.score,
      history_turns: fields.historyTurns,
      rewrite_chars: fields.chars,
      rewrite_truncated: fields.truncated,
      rewrite_ms: fields.ms,
    },
    fields.needRewrite
      ? `指代改写完成：${fields.chars} 字（历史 ${fields.historyTurns} 轮）`
      : '指代判定为否，本轮不改写',
  );
}

function logSkipped(
  deps: RewriteStageDeps,
  input: RewriteStageInput,
  reason: 'switch_off' | 'budget_exhausted',
): void {
  deps.logger?.info(
    {
      event: 'intent-focus.rewrite.skipped',
      thread_id: input.threadId,
      agent_name: input.agentName,
      reason,
    },
    reason === 'switch_off' ? '输入重写未开启，本轮跳过' : '剩余预算不足，放弃改写',
  );
}

function logDegraded(
  deps: RewriteStageDeps,
  input: RewriteStageInput,
  stage: 'judge' | 'rewrite',
  reason: string,
  detail: string,
): void {
  deps.logger?.warn(
    {
      event: 'intent-focus.rewrite.degraded',
      alert: true,
      stage,
      reason,
      detail,
      thread_id: input.threadId,
      agent_name: input.agentName,
    },
    `指代改写（${stage}）降级，本轮按原文聚焦：${reason}`,
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
