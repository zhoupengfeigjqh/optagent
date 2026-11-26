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
  DEFAULT_PLAN_LIMITS,
  HISTORY_TURNS,
  IDLE_TURNS_MAX,
  PLAN_RETRY_MAX,
  type CheckFailure,
  type PlanFinishReason,
  type PlanLimits,
  type PlanProgress,
  type PlanProgressPhase,
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

export type PlanLlm = (request: {
  system: string;
  messages: PlanChatMessage[];
  signal: AbortSignal;
}) => Promise<string>;

export interface PlanLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface PlanOrchestratorInput {
  goal: string;
  userInput: string;
  focusPrompt: string;
  history: readonly HistoryMessage[];
  tools: readonly AgentTool[];
  ontology: OntologyIndex;
  facts: OntologyFacts;
  behaviorOf(toolName: string): BehaviorLookup | null;
  isStale?(toolName: string): boolean;
  plan: PlanLlm;
  signal: AbortSignal;
  logger: PlanLogger;
  suspend?: (code: string) => void;
  /**
   * 计划留档回调（2026-11-26）：**只写不读，不参与上下文组装**。
   *
   * 只在「真的产出过步骤」时回调（`snapshotSteps.length > 0`），避免把
   * 跳过 / 首轮 `[]` / 直接失败的空轮也写进留档。缺省不落盘（单测路径）。
   */
  record?: (record: PlanRunRecord) => void;
  /**
   * 计划进度回调（028 FR-034）：只带**当前步**的单行进度，供聊天区进度条消费。
   *
   * 三个发点与 FR-034 一致：装批/步推进（`running`）、重规划装批（`replanned`）、收尾（`done`）。
   * 空轮（无步骤）一次都不发；缺省不发（单测与关闭态零差异）。
   */
  onProgress?: (event: PlanProgress) => void;
  /**
   * 028：可运维的规划上限（`config.yaml` 的 `plan` 块）。
   *
   * 缺省取 `DEFAULT_PLAN_LIMITS`（= 原常量），单测与未配置部署零差异；
   * 装配层由 `server.ts` 注入，避免纯函数模块反向依赖配置。
   */
  limits?: PlanLimits;
}

export interface PlanHooks {
  prepareNextTurn(context: PrepareNextTurnContext): AgentLoopTurnUpdate | undefined;
  afterToolCall(context: AfterToolCallContext): Promise<void>;
  shouldStopAfterTurn(context: ShouldStopAfterTurnContext): boolean | Promise<boolean>;
  getFollowUpMessages(): Promise<AgentMessage[]>;
}

export interface PlanOrchestrator {
  readonly hooks: PlanHooks;
  begin(): Promise<boolean>;
  initialTools(): AgentTool[];
  initialMessages(messages: readonly HistoryMessage[]): HistoryMessage[];
  finishReason(): PlanFinishReason | null;
  state(): PlanState;
}

const SUSPEND_CODE = 'PLAN_FINISHED';

export function createPlanOrchestrator(input: PlanOrchestratorInput): PlanOrchestrator {
  const limits: PlanLimits = input.limits ?? DEFAULT_PLAN_LIMITS;
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

  /** 进度发点（唯一）：只发当前步；空轮不发（FR-034 / FR-004a） */
  function emitProgress(step: PlanStep | null, phase: PlanProgressPhase): void {
    if (input.onProgress === undefined || step === null) return;
    input.onProgress({ seqId: step.seqId, label: step.taskName, phase });
  }

  /** 收尾时"最后一步"：当前步为空（已出队）时取快照末步，保证 `done` 有归属 */
  function lastSnapshotStep(): PlanStep | null {
    return snapshotSteps.length > 0 ? snapshotSteps[snapshotSteps.length - 1]! : null;
  }

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
      recordRun(reason);
      // 收尾只发一次 `done`（FR-034 第三处发点）；空轮由 `emitProgress` 的 null 判据挡掉
      emitProgress(state.current ?? lastSnapshotStep(), 'done');
      if (reason !== 'completed' && reason !== 'aborted') input.suspend?.(SUSPEND_CODE);
    }
    return true;
  }

  function promptInput(kind: PlanKind, feedback?: string): Parameters<typeof buildPlanPrompt>[0] {
    const initial = kind === 'initial';
    const retryOnly = initial && feedback !== undefined ? { retryFeedback: feedback } : {};
    return {
      focusPrompt: input.focusPrompt,
      ontology: input.ontology,
      toolNames: input.tools.map((tool) => tool.name),
      nameIndex,
      behaviorOf: input.behaviorOf,
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
          limits.timeoutMs,
        );
      } catch (err) {
        if (input.signal.aborted) {
          terminate('aborted');
          return null;
        }
        // 超时**不重试**（2026-11-26）：超时的原因是"慢"，原样再发两次大概率还是慢，
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

  /**
   * 装批：入队 + 切可见工具 + 启动事件 + 进度。
   *
   * `phase` 只区分「正常装批」与「重规划装批」——重规划会让步骤编号跳变，
   * 前端据此做一次"计划已调整"的提示（FR-034 / FR-035）。
   */
  function enqueue(steps: PlanStep[], phase: 'running' | 'replanned' = 'running'): void {
    snapshotSteps.push(...steps);
    startBatch(state, steps);
    if (state.turnIndex === 0) state.turnIndex = 1;
    refreshVisible();
    if (state.current !== null) {
      logStepStarted(state.current);
      emitProgress(state.current, phase);
    }
  }

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
    enqueue(steps, 'replanned');
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
    enqueue(steps, 'replanned');
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
        limits,
      });
      state.turnIndex = judgedTurn + 1;
      coreOutcomes = [];

      if (result.stepDone && active !== null) {
        // 步与步之间也要切可见工具：否则推进到第 2 步后模型仍只看到第 1 步的工具，
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
        if (!result.needsReplan && state.current !== null) {
          logStepStarted(state.current);
          // 步推进（FR-034 第一处发点）：与 `refreshVisible()` 同点，避免"进度跳了但工具集没切"
          emitProgress(state.current, 'running');
        }
      }

      if (result.finish === 'stalled' && state.replanCount < limits.replanMaxPerRun) {
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
