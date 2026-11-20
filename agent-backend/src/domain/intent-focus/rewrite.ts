/**
 * 指代改写（027）的**编排**层：开关 → 指代判定 → 素材 → 改写 → 归一 → 降级 → 计时。
 *
 * 三条硬约束（契约 C-1 / C-4 / C-5）：
 * - 改写结果**只经返回值**进入后续评分，不写 `opts` / 历史 / `systemExtra` / SSE；
 * - 判定与改写共用意图聚焦的**阶段预算**，任一失败只降级（回退原文），绝不冒泡；
 * - 每轮**至多一次**改写：不对改写结果再做指代判断，不递归。
 *
 * 为什么单独成文件（宪章原则二）：`runner.ts` 是存量超限文件（见 plan 复杂度跟踪），
 * 本特性只允许在它里面加"调用 + 使用返回值"，把开关 / 预算 / 降级矩阵放在这里。
 * 文字处理全在 `rewrite-prompt.ts`（纯函数），本文件只做顺序与取舍。
 */
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

/** 一次性文本生成端口（domain 只依赖它；实现见 `infra/rewrite-llm.ts`） */
export interface RewriteLlmRequest {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** 本轮生效模型（请求级覆盖优先）；缺省 = 服务默认模型 */
  model?: ModelSelection;
  timeoutMs: number;
  /** 本轮中止信号（用户停止 / 关机） */
  signal?: AbortSignal;
}

export interface RewriteLlm {
  complete(req: RewriteLlmRequest): Promise<string>;
}

/** 读该线程全部消息（复用 `HistoryStore.readAll` 的结构子集） */
export type ReadHistory = (
  userId: string,
  agentName: string,
  threadId: string,
) => ReadonlyArray<RewriteHistoryMessage>;

/** 改写阶段的原因枚举（记录与日志共用同一组字面量） */
export type RewriteReason =
  | 'judge_failed'
  | 'below_threshold'
  | 'llm_failed'
  | 'empty_output'
  | 'budget_exhausted'
  | 'no_history';

/** 一轮改写阶段的产出：送进评分的文本 + 留档所需的全部事实 */
export interface RewriteOutcome {
  /** 送进技能 / 行为评分与发散的文本 */
  state: string;
  /** `state` 是否被 200 字截断（改写 ≤100 字时恒 `false`） */
  truncated: boolean;
  /** 来源：改写成功 = `rewrite`，其余 = `original`（与改造前逐字一致） */
  origin: 'rewrite' | 'original';
  /** 判定结论；`null` = 未执行或判定失败 */
  needRewrite: boolean | null;
  /** 单条命题分数 */
  score: number | null;
  /** 改写文本；空串 = 未改写 */
  rewrite: string;
  rewriteTruncated: boolean;
  rewriteMs: number | null;
  /** 参与的历史轮数（0~3） */
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
  /** 输入重写开关（调用方已逐次读盘，且意图聚焦已确认开启） */
  enabled: boolean;
  /** Laya 判定客户端；缺省 = 判定不可用（按判定失败降级） */
  client?: DecideClient;
  /** 缺省 = 改写不可用（本轮按原文聚焦，零副作用） */
  rewriteLlm?: RewriteLlm;
  /** 缺省 = 无历史可参考（素材只有当前输入） */
  readHistory?: ReadHistory;
  logger?: RewriteStageLogger;
  now?: () => number;
}

export interface RewriteStageInput {
  userId: string;
  agentName: string;
  threadId: string;
  /** 本轮输入（术语替换确认后） */
  userInput: string;
  /** 意图聚焦阶段的总截止时间（毫秒时间戳） */
  deadline: number;
  /** 本轮生效模型（请求级覆盖优先） */
  model?: ModelSelection;
  /** 本轮中止信号 */
  signal?: AbortSignal;
}

/**
 * 执行一轮改写阶段。**永不抛错**：任何异常都折成"用原文继续"。
 */
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

  // 1. 开关关闭：零判定、零改写、零读历史（C-3）。日志只记事件，记录里的 reason 保持 null
  //    ——"未执行"不是"失败"（契约 §8）。
  if (!deps.enabled) {
    logSkipped(deps, input, 'switch_off');
    return original();
  }

  // 改写通道未装配（理论上只在测试里出现）：同样按"未执行"处理
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

  // 3. 未达阈值：不发起改写（严格大于，等号不改写）
  if (!shouldRewrite(score, deps.config.rewriteThreshold)) {
    logDone(deps, input, { score, needRewrite: false, historyTurns: 0, chars: 0, truncated: false, ms: null });
    return { ...original(), needRewrite: false, score, reason: 'below_threshold' };
  }

  // 4. 预算不足：判为需要改写，但不再发起调用（回退原文，记录可区分）
  const remaining = input.deadline - now();
  if (remaining < MIN_REWRITE_BUDGET_MS) {
    logSkipped(deps, input, 'budget_exhausted');
    return { ...original(), needRewrite: true, score, reason: 'budget_exhausted' };
  }

  // 5. 素材：最近 3 个完整问答轮 + 本轮输入（只读正文，不追加附件段）
  let turns = [] as ReturnType<typeof pickRecentTurns>;
  if (deps.readHistory) {
    try {
      turns = pickRecentTurns(deps.readHistory(input.userId, input.agentName, input.threadId));
    } catch (err) {
      // 历史读失败不阻断改写：素材退化为"只有当前输入"
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
      // 只记长度，不记文本（原文与改写全文都不允许落日志）
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
