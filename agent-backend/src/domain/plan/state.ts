/**
 * 计划状态机（028 FR-018~FR-028）。
 *
 * 两块职责，都是纯函数（无 IO、无日志、无随机）：
 * 1. **三态归类**：把一次工具结果归入 `success` / `retryable` / `failed` / `ignored`；
 * 2. **状态推演**：完成判定（A/C）、出队推进、卡死指纹、终止判据。
 *
 * 只有 `advanceBatch` 会改变状态；调用点唯一（`shouldStopAfterTurn`）。
 * `afterToolCall` 走 `recordToolCall`，只记事实。
 */
import { RULE_DENIED_CODE, RULE_FUNCTIONS_MISSING_CODE } from '../rule-gate/types.js';
import {
  IDLE_TURNS_MAX,
  REPLAN_MAX_PER_RUN,
  RETRYABLE_MAX_PER_STEP,
  SUMMARY_KEEP,
  SUMMARY_LINE_MAX,
  TOTAL_STEPS_MAX,
  type PlanFinishReason,
  type PlanState,
  type PlanStep,
  type ToolOutcome,
} from './types.js';

/** 一次工具调用的事实（由 `afterToolCall` 采集，不含判定） */
export interface ToolCallFact {
  /** SDK 的 `toolCallId`（幂等用） */
  callId: string;
  /** 模型发起的工具名（完整名，原样） */
  toolName: string;
  isError: boolean;
  /** `readToolError()` 的 code；读不到为 null（SDK 侧错误 `details` 恒为 `{}`） */
  errorCode: string | null;
  /** 结果文本（仅用于 `Tool <name> not found` 兜底匹配） */
  text: string;
}

/** `ABORTED` 码（`llm-error.ts` 的既有口径） */
const ABORTED_CODE = 'ABORTED';

/** SDK 固定文案：`Tool <name> not found` */
const TOOL_NOT_FOUND = /^Tool\s+.+\s+not found$/;

/** 创建一份空计划状态 */
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

/**
 * 三态归类。
 *
 * 判定顺序固定 `isError` → code → message：SDK 侧错误结果的 `details` 恒为 `{}`，
 * 所以「参数校验失败 / 执行异常 / `Tool not found`」都读不到 code。
 */
export function classifyToolOutcome(fact: ToolCallFact): ToolOutcome {
  if (!fact.isError) return 'success';
  const code = fact.errorCode;
  if (code === RULE_FUNCTIONS_MISSING_CODE) return 'retryable';
  if (code === RULE_DENIED_CODE) return 'failed';
  if (code === ABORTED_CODE) return 'failed';
  if (code === null && TOOL_NOT_FOUND.test(fact.text.trim())) return 'ignored';
  return 'retryable';
}

/** 记录一次工具调用（只写事实，不改状态机） */
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

/** 一批结果处理完后的推演结论 */
export interface BatchResult {
  /** 当前步是否在本批完成（已完成出队） */
  stepDone: boolean;
  /** 需要终止（`null` 表示继续） */
  finish: PlanFinishReason | null;
  /** 是否需要失败重规划 */
  needsReplan: boolean;
  /** 本批被判定为失败的步骤（供重规划输入）；写后失效场景为 `null` */
  failedStep: PlanStep | null;
  /**
   * 写后失效（T502 / FR-024）：推进到的下一步，其 `dependTools` 里存在
   * 「本世代算过、但已被 command 的 `invalidate()` 打脏」的函数。
   *
   * 有值时 `failedStep` 必为 `null`——这一步**没有失败**，只是前置数据不再可信，
   * 直接执行会撞上闸门的 `RULE_FUNCTIONS_MISSING_CODE` 并白白多耗一轮。
   */
  staleStep?: PlanStep | null;
  /** 触发上面那次判定的函数名（裸名，供日志；不含结果正文） */
  staleFunctions?: readonly string[];
}

/** 推演输入 */
export interface AdvanceInput {
  /** 本批结束后的 turn 序号（1 起） */
  turnIndex: number;
  /** 本批中当前步 `coreAction` 的归类结果 */
  coreOutcomes: readonly ToolOutcome[];
  /** 本批模型文本（用于 `doneSummary` 截取；缺省用 taskName） */
  summaryText?: string;
  /**
   * 写后失效探测（T502）：入参为工具名（计划里的原样名），返回其函数记录是否「过期」。
   *
   * 口径由调用方给（`hasEver && !has`），本层不认识规则闸门，只做纯判定。
   */
  isStale?: (toolName: string) => boolean;
}

/**
 * 本批推演：归类结果 → 完成判定 / 失败 / 推进 / 终止。
 *
 * 完成判定（FR-020）：
 * ```
 * A  current.coreActionOk === true
 * C  current.lastCoreActionTurn < turnIndex
 * B  整批已闭合（由调用时机保证）
 * ```
 */
export function advanceBatch(state: PlanState, input: AdvanceInput): BatchResult {
  state.turnIndex = input.turnIndex;
  const step = state.current;
  if (step === null) {
    return { stepDone: false, finish: null, needsReplan: false, failedStep: null };
  }

  // 1. 失败优先：本批出现 failed（仅当前步 coreAction 致命）
  if (input.coreOutcomes.includes('failed')) {
    step.status = 'failed';
    state.current = null;
    state.replanCount += 1;
    return {
      stepDone: false,
      finish: checkReplanLimit(state),
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
      finish: checkReplanLimit(state),
      needsReplan: true,
      failedStep: step,
    };
  }

  // 3. 完成判定（A + C；B 由调用时机保证）
  const done = step.coreActionOk && step.lastCoreActionTurn < state.turnIndex;
  if (done) {
    step.status = 'done';
    state.totalSteps += 1;
    // 模型结论洗不出实质内容时，至少留下「做了什么」，不让该步在滚动规划里消失
    appendSummary(state, input.summaryText ?? '', `${step.taskName}（${step.coreActionLabel}）已完成`);
    state.current = state.queue.shift() ?? null;
    if (state.current !== null) {
      state.current.status = 'running';
      state.idleTurns = 0;
      state.lastFingerprint = fingerprint(state.current);

      // 3a. 写后失效（T502）：下一步的依赖函数已被上一步的写操作打脏。
      //     不把它标 failed——它还没执行过，只是前置数据不再可信；
      //     直接跑必然被闸门判「缺前置函数」白耗一轮，故先重规划。
      const stale = staleDependencies(state.current, input.isStale);
      if (stale.length > 0) {
        state.replanCount += 1;
        return {
          stepDone: true,
          finish: checkReplanLimit(state),
          needsReplan: true,
          failedStep: null,
          staleStep: state.current,
          staleFunctions: stale,
        };
      }
    }
    return { stepDone: true, finish: checkStepLimit(state), needsReplan: false, failedStep: null };
  }

  // 4. 本批没有推进：更新卡死指纹
  const current = fingerprint(step);
  if (current === state.lastFingerprint) state.idleTurns += 1;
  else {
    state.lastFingerprint = current;
    state.idleTurns = 0;
  }
  if (state.idleTurns >= IDLE_TURNS_MAX) return { stepDone: false, finish: 'stalled', needsReplan: true, failedStep: step };

  return { stepDone: false, finish: null, needsReplan: false, failedStep: null };
}

/** 把新一步装入 `current`（滚动/重规划换批时调用） */
export function startBatch(state: PlanState, steps: PlanStep[]): void {
  state.queue = steps.slice(1);
  const first = steps[0] ?? null;
  state.current = first;
  if (first !== null) first.status = 'running';
  state.idleTurns = 0;
  // 以"刚进入本步"为基线：第一次无进展即计 1 次，避免卡死判定被推迟一轮
  state.lastFingerprint = first === null ? '' : fingerprint(first);
}

/** 列出一批依赖里「记录已过期」的函数名（无探测器时恒为空） */
function staleDependencies(step: PlanStep, isStale?: (toolName: string) => boolean): string[] {
  if (isStale === undefined || step.dependTools.length === 0) return [];
  return step.dependTools.filter((toolName) => isStale(toolName));
}

/** 状态指纹：`seqId:coreActionOk:attempts`（连续不变即视为无进展） */
export function fingerprint(step: PlanStep): string {
  return `${step.seqId}:${step.coreActionOk ? 1 : 0}:${step.attempts}`;
}

/** Markdown 表格的分隔线（`|---|` / `|:--|`）：命中即认定这一段是表格 */
const TABLE_RULE = /\|\s*:?-{3,}/;

/** 断句点：截断时优先退到这些字符之后，避免切在词或半个句子中间 */
const BREAK_POINT = /[，。；、,.;:！？!?）)\]】」』\s]/;

/**
 * 剥掉 Markdown 表格，只留表格前的结论句。
 *
 * 2026-11-25 实测：模型把工具结果渲染成表格，80 字硬切后得到
 * `… | 可用库存 | 1810 | | 累`——表格断在半个单元格上，累计库存/待入库全丢。
 * 摘要只需要"做了什么"，细节本来就在最终回答里。
 */
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

/** 剥掉表格后可能只剩悬空引导语（「…**结果：**」「…如下：」），视为没有实质结论 */
const DANGLING_LEAD = /(?:\*{0,2}\s*(?:结果|结论|详情|如下)\s*[：:]\s*\*{0,2}|[：:])\s*$/;

/** 模型复述式开头（与步骤名重复），剥掉后才是真正结论 */
const BOILERPLATE_LEAD = /^当前这一步(?:已)?执行完毕\s*[：:，,]\s*/;

/** 清洗后不足这个长度，视为"没有实质结论"，改用兜底句 */
const SUMMARY_MIN_CHARS = 6;

/**
 * 把一段模型正文洗成一句结论。
 *
 * 2026-11-26：旧实现只 `stripTable` + 截断，模型写「…**结果：** + 表格」时表格被剥掉、
 * 只剩悬空引导语，滚动规划拿到一条没有任何事实的"结论"。
 */
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

/** 步数超限 → 终止（软收尾） */
function checkStepLimit(state: PlanState): PlanFinishReason | null {
  return state.totalSteps >= TOTAL_STEPS_MAX ? 'steps_exhausted' : null;
}

/** 失败重规划超限 → 终止（软收尾） */
function checkReplanLimit(state: PlanState): PlanFinishReason | null {
  return state.replanCount >= REPLAN_MAX_PER_RUN ? 'replan_exhausted' : null;
}
