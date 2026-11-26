import { RULE_DENIED_CODE, RULE_FUNCTIONS_MISSING_CODE } from '../rule-gate/types.js';
import {
  DEFAULT_PLAN_LIMITS,
  IDLE_TURNS_MAX,
  RETRYABLE_MAX_PER_STEP,
  SUMMARY_KEEP,
  SUMMARY_LINE_MAX,
  type PlanFinishReason,
  type PlanLimits,
  type PlanState,
  type PlanStep,
  type ToolOutcome,
} from './types.js';

export interface ToolCallFact {
  /** SDK 的 `toolCallId`（幂等用） */
  callId: string;
  toolName: string;
  isError: boolean;
  errorCode: string | null;
  /** 结果文本（仅用于 `Tool <name> not found` 兜底匹配） */
  text: string;
}

const ABORTED_CODE = 'ABORTED';

const TOOL_NOT_FOUND = /^Tool\s+.+\s+not found$/;

export function createPlanState(goal: string): PlanState {
  return {
    goal,
    queue: [],
    current: null,
    doneSummary: [],
    turnIndex: 0,
    totalSteps: 0,
    rollCount: 0,
    replanCount: 0,
    planRetryCount: 0,
    idleTurns: 0,
    lastFingerprint: '',
    seenCallIds: new Set<string>(),
    extraCalls: [],
  };
}

export function classifyToolOutcome(fact: ToolCallFact): ToolOutcome {
  if (!fact.isError) return 'success';
  const code = fact.errorCode;
  if (code === RULE_FUNCTIONS_MISSING_CODE) return 'retryable';
  if (code === RULE_DENIED_CODE) return 'failed';
  if (code === ABORTED_CODE) return 'failed';
  if (code === null && TOOL_NOT_FOUND.test(fact.text.trim())) return 'ignored';
  return 'retryable';
}

export function recordToolCall(state: PlanState, fact: ToolCallFact, turnIndex: number): ToolOutcome {
  const outcome = classifyToolOutcome(fact);
  const step = state.current;
  const isCore = step !== null && fact.toolName === step.coreAction;
  const known = isCore || (step !== null && step.dependTools.includes(fact.toolName));

  if (isCore && step !== null) {
    step.attempts += 1;
    if (outcome === 'success') {
      step.coreActionOk = true;
      step.lastCoreActionTurn = turnIndex;
      step.retryableStreak = 0;
    } else if (outcome === 'retryable') {
      step.retryableStreak += 1;
    }
  }
  if (!known && !state.extraCalls.includes(fact.toolName)) {
    state.extraCalls.push(fact.toolName);
  }
  return outcome;
}

export interface BatchResult {
  stepDone: boolean;
  finish: PlanFinishReason | null;
  needsReplan: boolean;
  failedStep: PlanStep | null;
  staleStep?: PlanStep | null;
  staleFunctions?: readonly string[];
}

export interface AdvanceInput {
  turnIndex: number;
  coreOutcomes: readonly ToolOutcome[];
  summaryText?: string;
  isStale?: (toolName: string) => boolean;
  /** 028：可配置的规划上限；缺省取 `DEFAULT_PLAN_LIMITS`（单测路径零差异） */
  limits?: PlanLimits;
}

export function advanceBatch(state: PlanState, input: AdvanceInput): BatchResult {
  const limits = input.limits ?? DEFAULT_PLAN_LIMITS;
  state.turnIndex = input.turnIndex;
  const step = state.current;
  if (step === null) {
    return { stepDone: false, finish: null, needsReplan: false, failedStep: null };
  }

  if (input.coreOutcomes.includes('failed')) {
    step.status = 'failed';
    state.current = null;
    state.replanCount += 1;
    return {
      stepDone: false,
      finish: checkReplanLimit(state, limits),
      needsReplan: true,
      failedStep: step,
    };
  }

  // 2. 连续 retryable 达上限 → failed
  if (step.retryableStreak >= RETRYABLE_MAX_PER_STEP) {
    step.status = 'failed';
    state.current = null;
    state.replanCount += 1;
    return {
      stepDone: false,
      finish: checkReplanLimit(state, limits),
      needsReplan: true,
      failedStep: step,
    };
  }

  const done = step.coreActionOk && step.lastCoreActionTurn < state.turnIndex;
  if (done) {
    step.status = 'done';
    state.totalSteps += 1;
    appendSummary(state, input.summaryText ?? '', `${step.taskName}（${step.coreActionLabel}）已完成`);
    state.current = state.queue.shift() ?? null;
    if (state.current !== null) {
      state.current.status = 'running';
      state.idleTurns = 0;
      state.lastFingerprint = fingerprint(state.current);

      const stale = staleDependencies(state.current, input.isStale);
      if (stale.length > 0) {
        state.replanCount += 1;
        return {
          stepDone: true,
          finish: checkReplanLimit(state, limits),
          needsReplan: true,
          failedStep: null,
          staleStep: state.current,
          staleFunctions: stale,
        };
      }
    }
    return { stepDone: true, finish: checkStepLimit(state, limits), needsReplan: false, failedStep: null };
  }

  const current = fingerprint(step);
  if (current === state.lastFingerprint) state.idleTurns += 1;
  else {
    state.lastFingerprint = current;
    state.idleTurns = 0;
  }
  if (state.idleTurns >= IDLE_TURNS_MAX) return { stepDone: false, finish: 'stalled', needsReplan: true, failedStep: step };

  return { stepDone: false, finish: null, needsReplan: false, failedStep: null };
}

export function startBatch(state: PlanState, steps: PlanStep[]): void {
  state.queue = steps.slice(1);
  const first = steps[0] ?? null;
  state.current = first;
  if (first !== null) first.status = 'running';
  state.idleTurns = 0;
  // 以"刚进入本步"为基线：第一次无进展即计 1 次，避免卡死判定被推迟一轮
  state.lastFingerprint = first === null ? '' : fingerprint(first);
}

function staleDependencies(step: PlanStep, isStale?: (toolName: string) => boolean): string[] {
  if (isStale === undefined || step.dependTools.length === 0) return [];
  return step.dependTools.filter((toolName) => isStale(toolName));
}

export function fingerprint(step: PlanStep): string {
  return `${step.seqId}:${step.coreActionOk ? 1 : 0}:${step.attempts}`;
}

const TABLE_RULE = /\|\s*:?-{3,}/;

/** 断句点：截断时优先退到这些字符之后，避免切在词或半个句子中间 */
const BREAK_POINT = /[，。；、,.;:！？!?）)\]】」』\s]/;

function stripTable(text: string): string {
  if (!TABLE_RULE.test(text)) return text;
  const cut = text.indexOf('|');
  return cut > 0 ? text.slice(0, cut).trim() : text;
}

/**
 * 按字符截断到 `max`（**含省略号**），并优先退到最近的断句点。
 *
 * 两个口径：
 * - 总长 MUST ≤ `max`（用户 2026-11-25 明确"最高保留 80 字"），故有效预算为 `max - 1`；
 * - 回退范围不小于一半预算，避免为了一个逗号砍掉大半条结论。
 */
function clipSummary(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const budget = Math.max(1, max - 1);
  const window = chars.slice(0, budget);
  const floor = Math.floor(budget / 2);
  for (let index = window.length - 1; index >= floor; index -= 1) {
    if (BREAK_POINT.test(window[index] ?? '')) {
      return `${window.slice(0, index + 1).join('').trimEnd()}…`;
    }
  }
  return `${window.join('')}…`;
}

const DANGLING_LEAD = /(?:\*{0,2}\s*(?:结果|结论|详情|如下)\s*[：:]\s*\*{0,2}|[：:])\s*$/;

const BOILERPLATE_LEAD = /^当前这一步(?:已)?执行完毕\s*[：:，,]\s*/;

/** 清洗后不足这个长度，视为"没有实质结论"，改用兜底句 */
const SUMMARY_MIN_CHARS = 6;

function cleanSummary(text: string): string {
  let out = stripTable(text).replace(BOILERPLATE_LEAD, '').trim();
  while (out !== '' && DANGLING_LEAD.test(out)) {
    out = out.replace(DANGLING_LEAD, '').trim();
  }
  return out;
}

/**
 * 追加一条已完成结论（单条含省略号 ≤80 字，只保留最近 5 条）。
 *
 * 取值优先级：模型结论（清洗后够长）→ 调用方兜底（通常是「步骤名（行为名）已完成」）→
 * 原文（整条都是表格且无兜底时，宁可截断也不让这条结论消失）。
 */
export function appendSummary(state: PlanState, text: string, fallback = ''): void {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const cleaned = cleanSummary(normalized);
  const substantive = Array.from(cleaned).length >= SUMMARY_MIN_CHARS;
  let source = normalized;
  if (substantive) source = cleaned;
  else if (fallback !== '') source = fallback;
  else if (cleaned !== '') source = cleaned;
  if (source === '') return;
  state.doneSummary.push(clipSummary(source, SUMMARY_LINE_MAX));
  if (state.doneSummary.length > SUMMARY_KEEP) {
    state.doneSummary.splice(0, state.doneSummary.length - SUMMARY_KEEP);
  }
}

function checkStepLimit(state: PlanState, limits: PlanLimits): PlanFinishReason | null {
  return state.totalSteps >= limits.totalStepsMax ? 'steps_exhausted' : null;
}

function checkReplanLimit(state: PlanState, limits: PlanLimits): PlanFinishReason | null {
  return state.replanCount >= limits.replanMaxPerRun ? 'replan_exhausted' : null;
}
