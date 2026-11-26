/**
 * 计划编排器（028 Phase 3~6）：本特性**唯一**含 IO 与日志的层。
 *
 * 职责边界：
 * - 纯函数（解析 / 归一 / 校验 / 状态机 / 快照 / 提示词）全在 `domain/plan/*`；
 * - 这里只做「调用 LLM → 组装输入 → 把结果交给纯函数 → 把钩子挂到 pi 的 loop」。
 *
 * 三条硬边界（data-model §11）：
 * 1. `afterToolCall` **只记录事实**，一切状态转移在 `shouldStopAfterTurn`；
 * 2. `prepareNextTurn` 只换 `context.tools` 成员与快照消息，**不动 `systemPrompt`**（KV-cache）；
 * 3. 过滤对象必须是已包装的 `guarded` 数组，`availableNames` 保持全量（由装配层保证）。
 */
import type {
  AfterToolCallContext,
  AgentLoopTurnUpdate,
  AgentMessage,
  AgentTool,
  PrepareNextTurnContext,
  ShouldStopAfterTurnContext,
} from '@earendil-works/pi-agent-core';

import type { OntologyIndex } from '../domain/intent-focus/types.js';
import {
  failureNarrative,
  replanReasonOf,
  warnOutOfFocus,
  assistantText,
  collectAvailable,
  isBuiltinTool,
  normalizeBatch as normalizeBatchOf,
  renderContinueInput,
  type PlanKind,
  type StaleStep,
} from '../domain/plan/batch.js';
import { checkPlan } from '../domain/plan/check.js';
import { buildToolNameIndex, type OntologyFacts } from '../domain/plan/normalize.js';
import { parsePlanOutput } from '../domain/plan/parse.js';
import {
  buildPlanPrompt,
  renderRetryFeedback,
  type PlanChatMessage,
} from '../domain/plan/prompt.js';
import { applySnapshotMessage, renderSnapshot } from '../domain/plan/snapshot.js';
import type { PlanRunRecord } from '../domain/plan/store.js';
import {
  advanceBatch,
  createPlanState,
  recordToolCall,
  startBatch,
  type ToolCallFact,
} from '../domain/plan/state.js';
import {
  HISTORY_TURNS,
  IDLE_TURNS_MAX,
  PLAN_RETRY_MAX,
  REPLAN_MAX_PER_RUN,
  type CheckFailure,
  type PlanFinishReason,
  type PlanState,
  type PlanStep,
  type RawStep,
  type ToolOutcome,
} from '../domain/plan/types.js';
import type { BehaviorLookup } from '../domain/rule-gate/types.js';
import { readToolError } from '../domain/tool-error.js';
import { serializeToolResult } from '../domain/tool-result.js';
import type { HistoryMessage } from '../types.js';
import { callPlanWithTimeout, PlanCallTimeoutError } from './plan-llm.js';

/** 规划调用（注入以便单测用桩；生产实现是 `PiAiLlmProvider.streamChat` 聚合） */
export type PlanLlm = (request: {
  system: string;
  messages: PlanChatMessage[];
  signal: AbortSignal;
}) => Promise<string>;

/** 结构化日志口（字段名与 data-model §10 一致） */
export interface PlanLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface PlanOrchestratorInput {
  /** 本轮用户原话（已截断） */
  goal: string;
  userInput: string;
  /** 意图聚焦提示原文；空串 = 无起点，规划跳过 */
  focusPrompt: string;
  history: readonly HistoryMessage[];
  /** 本轮已包装工具（`guarded`），过滤对象只能是它 */
  tools: readonly AgentTool[];
  ontology: OntologyIndex;
  facts: OntologyFacts;
  behaviorOf(toolName: string): BehaviorLookup | null;
  /**
   * 写后失效探测（T502）：`hasEver && !has` —— 「本世代算过、但已被 command 打脏」。
   *
   * 缺省不探测（单测/关闭闸门时行为与之前一致）。
   */
  isStale?(toolName: string): boolean;
  plan: PlanLlm;
  signal: AbortSignal;
  logger: PlanLogger;
  /** 软收尾出口（②~⑤ 超限）：挂起本轮工具，模型总结后正常结束 */
  suspend?: (code: string) => void;
  /**
   * 计划留档回调（2026-11-26）：**只写不读，不参与上下文组装**。
   *
   * 只在「真的产出过步骤」时回调（`snapshotSteps.length > 0`），避免把
   * 跳过 / 首轮 `[]` / 直接失败的空轮也写进留档。缺省不落盘（单测路径）。
   */
  record?: (record: PlanRunRecord) => void;
}

export interface PlanHooks {
  prepareNextTurn(context: PrepareNextTurnContext): AgentLoopTurnUpdate | undefined;
  afterToolCall(context: AfterToolCallContext): Promise<void>;
  shouldStopAfterTurn(context: ShouldStopAfterTurnContext): boolean | Promise<boolean>;
  getFollowUpMessages(): Promise<AgentMessage[]>;
}

export interface PlanOrchestrator {
  readonly hooks: PlanHooks;
  /** 首轮规划；`false` = 不进入规划，调用方回退既有流程 */
  begin(): Promise<boolean>;
  /** 首轮可见工具集（`begin()` 为真时有效） */
  initialTools(): AgentTool[];
  /** 首轮 messages：在历史末尾追加计划快照（不改入参） */
  initialMessages(messages: readonly HistoryMessage[]): HistoryMessage[];
  /** 终止原因（未终止为 `null`） */
  finishReason(): PlanFinishReason | null;
  state(): PlanState;
}

/** 软收尾的挂起码（复用挂起通道，不新增错误码语义） */
const SUSPEND_CODE = 'PLAN_FINISHED';

export function createPlanOrchestrator(input: PlanOrchestratorInput): PlanOrchestrator {
  const state = createPlanState(input.goal);
  const nameIndex = buildToolNameIndex(input.tools);
  const available = collectAvailable(input.tools.map((tool) => tool.name));
  const snapshotSteps: PlanStep[] = [];

  const startedAt = Date.now();
  let seqCounter = 0;
  let visible: AgentTool[] = [];
  let finished: PlanFinishReason | null = null;
  let coreOutcomes: ToolOutcome[] = [];
  let followUps = 0;

  const log = (fields: Record<string, unknown>, message: string): void =>
    input.logger.info(fields, message);

  /**
   * 收尾留档（2026-11-26）：只把**本轮真的产出过步骤**的事实交出去。
   *
   * 跳过 / 首轮 `[]` / 装配失败等空轮不写，避免留档被空噪音填满；
   * 回调自身的失败也只告警——留档永远不得影响本轮对话。
   *
   * 发点唯一：`terminate()`。**用户点停止（`aborted`）的轮次可以没有 `plan.jsonl`**
   * （2026-11-26 产品口径确认）：中止走的是 `run.stop()`，不经过状态机终止判定，
   * 本轮历史本身也不落盘，留档同样不留。
   */
  function recordRun(reason: PlanFinishReason): void {
    if (input.record === undefined || snapshotSteps.length === 0) return;
    const record: PlanRunRecord = {
      goal: input.goal,
      reason,
      total_steps: state.totalSteps,
      rolls: state.rollCount,
      replans: state.replanCount,
      duration_ms: Date.now() - startedAt,
      done_summary: [...state.doneSummary],
      steps: snapshotSteps.map((step) => ({
        seq_id: step.seqId,
        task_name: step.taskName,
        type: step.type,
        core_action: step.coreAction,
        status: step.status,
        attempts: step.attempts,
      })),
    };
    try {
      input.record(record);
    } catch (err) {
      input.logger.warn({ event: 'plan.record.failed', err }, '计划留档回调失败（不影响本轮对话）');
    }
  }

  /** 终止：`completed` / `aborted` 不走软收尾，其余必须挂起工具（FR-027） */
  function terminate(reason: PlanFinishReason): true {
    if (finished === null) {
      finished = reason;
      log(
        {
          event: 'plan.finished',
          reason,
          total_steps: state.totalSteps,
          rolls: state.rollCount,
          replans: state.replanCount,
        },
        '计划阶段结束',
      );
      // 留档在挂起之前：挂起会立即中止本轮，之后没有可靠发点
      recordRun(reason);
      if (reason !== 'completed' && reason !== 'aborted') input.suspend?.(SUSPEND_CODE);
    }
    return true;
  }

  /** 组装一次规划调用的输入（三类驱动共用同一提示词装配） */
  function promptInput(kind: PlanKind, feedback?: string): Parameters<typeof buildPlanPrompt>[0] {
    const initial = kind === 'initial';
    // 首次规划的重试沿用完整历史 + 反馈消息；重规划把失败原因写进角色消息（FR-025）
    const retryOnly = initial && feedback !== undefined ? { retryFeedback: feedback } : {};
    return {
      focusPrompt: input.focusPrompt,
      ontology: input.ontology,
      toolNames: input.tools.map((tool) => tool.name),
      nameIndex,
      behaviorOf: input.behaviorOf,
      // 只有首次规划带历史；重规划只给「目标 + 已完成 + 失败原因」（FR-025）
      history: initial ? input.history : [],
      userInput: initial
        ? input.userInput
        : renderContinueInput({
            goal: input.goal,
            doneSummary: state.doneSummary,
            kind,
            ...(feedback !== undefined ? { failure: feedback } : {}),
          }),
      ...retryOnly,
    };
  }

  /** 一次规划（含最多 `PLAN_RETRY_MAX` 次重试）；`null` = 放弃规划 */
  async function requestBatch(kind: PlanKind, failure?: string): Promise<PlanStep[] | null> {
    let feedback = failure;
    for (let attempt = 0; attempt <= PLAN_RETRY_MAX; attempt += 1) {
      if (attempt > 0) state.planRetryCount += 1;
      const prompt = buildPlanPrompt(promptInput(kind, feedback));
      log(
        {
          event: 'plan.requested',
          retry: attempt,
          tool_count: input.tools.length,
          history_turns: kind === 'initial' ? HISTORY_TURNS : 0,
          command_count: prompt.commandCount,
          system_chars: prompt.systemChars,
        },
        '发起规划调用',
      );

      let text: string;
      try {
        text = await callPlanWithTimeout(
          input.plan,
          { system: prompt.system, messages: prompt.messages },
          input.signal,
        );
      } catch (err) {
        if (input.signal.aborted) {
          terminate('aborted');
          return null;
        }
        // 超时**不重试**（2026-11-26）：超时的原因是"慢"，原样再发两次大概率还是慢，
        // 只会让首字延迟变成 2~3 倍。直接放弃规划、回退既有流程（FR-005）。
        if (err instanceof PlanCallTimeoutError) {
          log(
            { event: 'plan.abandoned', reason: 'timeout', timeout_ms: err.timeoutMs },
            '规划调用超时，放弃规划并回退既有流程',
          );
          return null;
        }
        feedback = `上一次规划调用失败（${(err as Error).message}），请重新输出完整 JSON 数组。`;
        continue;
      }

      const parsed = parsePlanOutput(text);
      if (!parsed.ok) {
        log({ event: 'plan.rejected', failures: [parsed.failure] }, '规划输出解析失败，准备重试');
        feedback = renderRetryFeedback([parsed.failure]);
        continue;
      }
      log(
        { event: 'plan.parsed', steps: parsed.steps.length, raw_chars: text.length },
        '规划输出已解析',
      );
      if (parsed.steps.length === 0) return [];

      const normalized = normalizeBatch(parsed.steps);
      const checked = checkPlan({
        steps: normalized.steps,
        available,
        behaviorOf: input.behaviorOf,
        preFailures: normalized.failures,
      });
      if (!checked.ok) {
        log({ event: 'plan.rejected', failures: checked.failures }, '规划未通过硬校验，准备重试');
        feedback = renderRetryFeedback(checked.failures);
        continue;
      }
      warnOutOfFocus(normalized.steps, input.focusPrompt, input.logger);
      return normalized.steps;
    }

    log(
      { event: 'plan.abandoned', retry: PLAN_RETRY_MAX, reason: 'retry_exhausted' },
      '规划重试耗尽，放弃规划并回退既有流程',
    );
    return null;
  }

  /** 归一（`seqId` 只在校验通过后提交，避免失败重试留下空洞） */
  function normalizeBatch(raw: readonly RawStep[]): {
    steps: PlanStep[];
    failures: CheckFailure[];
  } {
    const result = normalizeBatchOf({
      raw,
      base: seqCounter,
      nameIndex,
      behaviorOf: input.behaviorOf,
      facts: input.facts,
    });
    if (result.steps.length === 0) return { steps: [], failures: result.failures };
    seqCounter = result.nextSeqId;
    result.steps.forEach((step, index) => {
      const declared = raw[index]?.type ?? '';
      if (declared !== '' && declared !== step.type) {
        input.logger.warn(
          {
            event: 'plan.type.mismatch',
            seq_id: step.seqId,
            declared,
            derived: step.type,
          },
          '模型声明的 type 与后端推导不一致，以后端为准（不重规划）',
        );
      }
    });
    return { steps: result.steps, failures: result.failures };
  }

  /** 装批：入队 + 切可见工具 + 记录启动事件 */
  function enqueue(steps: PlanStep[]): void {
    snapshotSteps.push(...steps);
    startBatch(state, steps);
    // 首步从 turn 1 起算；跨批不重置，保持 turn 序单调（C 判据只比较步内调用）
    if (state.turnIndex === 0) state.turnIndex = 1;
    refreshVisible();
    if (state.current !== null) logStepStarted(state.current);
  }

  /**
   * 「进入某一步」的唯一发点（2026-11-26）。
   *
   * 批首步由 `enqueue` 触发，同批推进由 `shouldStopAfterTurn` 触发；
   * 只在这里发，保证 `plan.step.started` 与 `plan.step.done` 一一对应，
   * 且 `visible_tool_count` 拿到的一定是**该步**收窄后的工具数。
   */
  function logStepStarted(step: PlanStep): void {
    log(
      {
        event: 'plan.step.started',
        seq_id: step.seqId,
        core_action: step.coreAction,
        type: step.type,
        visible_tool_count: visible.length,
      },
      '进入下一步',
    );
  }

  function refreshVisible(): void {
    const current = state.current;
    if (current === null) {
      visible = [];
      return;
    }
    const allowed = new Set<string>([current.coreAction, ...current.dependTools]);
    visible = input.tools.filter((tool) => allowed.has(tool.name) || isBuiltinTool(tool.name));
  }

  function snapshotText(): string {
    return renderSnapshot({
      goal: state.goal,
      steps: snapshotSteps,
      doneSummary: state.doneSummary,
    });
  }

  /** 失败重规划（`replanCount` 已由状态机累加） */
  async function replanAfterFailure(failed: PlanStep | null, stale?: StaleStep): Promise<boolean> {
    log(
      {
        event: 'plan.replanned',
        kind: 'failure',
        count: state.replanCount,
        reason: replanReasonOf(failed, stale),
        goal_changed: false,
      },
      stale !== undefined ? '写后失效，触发失败重规划' : '触发失败重规划',
    );
    const steps = await requestBatch('failure', failureNarrative(failed, stale));
    if (steps === null) {
      terminate('plan_exhausted');
      return false;
    }
    if (steps.length === 0) {
      terminate('completed');
      return false;
    }
    enqueue(steps);
    return true;
  }

  /** 滚动规划（队列耗尽；`rollCount` 不设独立上限） */
  async function roll(): Promise<boolean> {
    state.rollCount += 1;
    log(
      { event: 'plan.replanned', kind: 'roll', count: state.rollCount, goal_changed: false },
      '队列耗尽，发起滚动规划',
    );
    const steps = await requestBatch('roll');
    if (steps === null) {
      terminate('plan_exhausted');
      return false;
    }
    if (steps.length === 0) {
      terminate('completed');
      return false;
    }
    enqueue(steps);
    return true;
  }

  const hooks: PlanHooks = {
    prepareNextTurn(context) {
      return {
        context: {
          systemPrompt: context.context.systemPrompt,
          messages: applySnapshotMessage(
            context.context.messages,
            snapshotText(),
          ) as AgentMessage[],
          tools: visible,
        },
      };
    },

    async afterToolCall(context) {
      if (finished !== null) return;
      const error = readToolError((context.result as { details?: unknown } | undefined)?.details);
      const fact: ToolCallFact = {
        callId: context.toolCall.id,
        toolName: context.toolCall.name,
        isError: context.isError || error !== undefined,
        errorCode: error?.code ?? null,
        text: serializeToolResult(context.result).text,
      };
      if (state.seenCallIds.has(fact.callId)) return;
      state.seenCallIds.add(fact.callId);
      const outcome = recordToolCall(state, fact, state.turnIndex);
      if (state.current !== null && fact.toolName === state.current.coreAction) {
        coreOutcomes.push(outcome);
      }
    },

    async shouldStopAfterTurn(context) {
      if (finished !== null) return true;
      const judgedTurn = state.turnIndex;
      const active = state.current;
      const result = advanceBatch(state, {
        turnIndex: judgedTurn,
        coreOutcomes,
        summaryText: assistantText(context.message),
        ...(input.isStale !== undefined ? { isStale: input.isStale } : {}),
      });
      state.turnIndex = judgedTurn + 1;
      coreOutcomes = [];

      if (result.stepDone && active !== null) {
        // 步与步之间也要切可见工具：否则推进到第 2 步后模型仍只看到第 1 步的工具，
        // 直接调用会得到 `Tool not found`（T403 防的就是这个死锁）
        refreshVisible();
        log(
          {
            event: 'plan.step.done',
            seq_id: active.seqId,
            attempts: active.attempts,
            turns: judgedTurn,
          },
          '当前步完成',
        );
        // 同批推进到下一步：补一次 started（2026-11-26）。不补的话第 2 步起既没有
        // started 事件，也看不到 visible_tool_count 的收窄，排障只能靠 tool.call 反推。
        // 需要重规划时这一步会被整批替换，故不发，等新批 enqueue 时再发。
        if (!result.needsReplan && state.current !== null) logStepStarted(state.current);
      }

      if (result.finish === 'stalled' && state.replanCount < REPLAN_MAX_PER_RUN) {
        // 卡死先尝试一次失败重规划；超限才按终止处理（T603）
        state.replanCount += 1;
        log(
          {
            event: 'plan.step.stalled',
            seq_id: state.current?.seqId ?? null,
            idle_turns: state.idleTurns,
          },
          '连续无进展，转失败重规划',
        );
        return (await replanAfterFailure(result.failedStep)) ? false : true;
      }
      if (result.finish !== null) return terminate(result.finish);
      if (result.needsReplan) {
        // 写后失效（T502）：这一步没失败，只是前置数据过期 —— 不记 `plan.step.failed`
        if (result.staleStep !== undefined && result.staleStep !== null) {
          return (await replanAfterFailure(null, {
            step: result.staleStep,
            functions: result.staleFunctions ?? [],
          }))
            ? false
            : true;
        }
        log(
          {
            event: 'plan.step.failed',
            seq_id: result.failedStep?.seqId ?? null,
            attempts: result.failedStep?.attempts ?? 0,
          },
          '当前步失败，转失败重规划',
        );
        return (await replanAfterFailure(result.failedStep)) ? false : true;
      }
      if (state.current === null) return (await roll()) ? false : true;
      return false;
    },

    async getFollowUpMessages() {
      const current = state.current;
      if (finished !== null || current === null) return [];
      if (followUps >= IDLE_TURNS_MAX) return [];
      followUps += 1;
      return [
        {
          role: 'user',
          content: `请继续执行第 ${current.seqId} 步「${current.taskName}」：调用 ${current.coreActionLabel}。完成后系统会推进到下一步。`,
        } as AgentMessage,
      ];
    },
  };

  return {
    hooks,
    async begin() {
      if (input.tools.length === 0) {
        log({ event: 'plan.skipped', reason: 'no_tools' }, '本轮无可用工具，跳过规划');
        finished = 'unavailable';
        return false;
      }
      if (input.focusPrompt.trim() === '') {
        log({ event: 'plan.skipped', reason: 'empty_focus' }, '本轮无意图聚焦结果，跳过规划');
        finished = 'unavailable';
        return false;
      }

      const steps = await requestBatch('initial');
      if (steps === null) {
        finished = 'unavailable';
        return false;
      }
      if (steps.length === 0) {
        // FR-004a①：首次返回 [] = 无需工具，交回主对话（不是失败）
        terminate('completed');
        return false;
      }
      log(
        {
          event: 'plan.started',
          goal: input.goal,
          steps: steps.map((step) => ({
            seq_id: step.seqId,
            type: step.type,
            core_action: step.coreAction,
          })),
        },
        '规划完成，进入执行阶段',
      );
      enqueue(steps);
      return true;
    },
    initialTools() {
      return visible;
    },
    initialMessages(messages) {
      return [...messages, { role: 'user', content: snapshotText() }];
    },
    finishReason() {
      return finished;
    },
    state() {
      return state;
    },
  };
}
