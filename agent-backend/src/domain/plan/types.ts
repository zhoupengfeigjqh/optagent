import { builtinToolNames } from '../builtin-tool-catalog.js';

export const PLAN_MIN_STEPS = 1;

export const PLAN_MAX_STEPS = 3;

/** 单批规划重试上限（解析/校验失败；**不是**执行期的失败重规划） */
export const PLAN_RETRY_MAX = 2;

/** 失败驱动重规划上限（**不含**正常滚动） */
export const REPLAN_MAX_PER_RUN = 6;

/** 单轮总步数上限（2026-11-25 由 10 调整为 20） */
export const TOTAL_STEPS_MAX = 20;

/**
 * 正常滚动次数上限：**无上限**，只受 `TOTAL_STEPS_MAX` 约束。
 *
 * 常量存在是为了显式表达"不设限"，避免实现时随手写一个 magic number。
 */
export const ROLL_MAX_PER_RUN = Number.POSITIVE_INFINITY;

/** 连续无进展的 turn 数上限（状态指纹不变） */
export const IDLE_TURNS_MAX = 2;

/** 同一步 `retryable` 连续次数上限，达上限转 `failed` */
export const RETRYABLE_MAX_PER_STEP = 3;

/** `taskName` 字数上限 */
export const TASK_NAME_MAX = 20;

/** `content` 字数上限 */
export const CONTENT_MAX = 300;

/** `doneSummary` 单条字数上限 */
export const SUMMARY_LINE_MAX = 80;

export const SUMMARY_KEEP = 5;

/** 计划快照总字数上限 */
export const SNAPSHOT_MAX_CHARS = 1200;

export const PLAN_TIMEOUT_MS = 20_000;

/**
 * 028（2026-11-26）：可运维的三个规划上限，来自 `config.yaml` 的 `plan` 块。
 *
 * 只有这三项允许配置——它们随**业务复杂度与模型能力**变（换慢模型要放宽超时、
 * 换简单域可收紧步数），其余 13 项常量是算法不变量（改了就是改规格）。
 * 缺省即上面的常量，单测与未配置部署零差异。
 */
export interface PlanLimits {
  timeoutMs: number;
  totalStepsMax: number;
  replanMaxPerRun: number;
}

export const DEFAULT_PLAN_LIMITS: PlanLimits = {
  timeoutMs: PLAN_TIMEOUT_MS,
  totalStepsMax: TOTAL_STEPS_MAX,
  replanMaxPerRun: REPLAN_MAX_PER_RUN,
};

export const HISTORY_TURNS = 3;

/** 每一步都必须可见的内置工具（取自目录唯一来源，新增内置工具自动生效） */
export const BUILTIN_TOOL_NAMES: readonly string[] = builtinToolNames();

export type StepType = 'command' | 'query' | 'function';

/** 步骤状态（`done` 为终态，禁止回退） */
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export type ToolOutcome = 'success' | 'retryable' | 'failed' | 'ignored';

export type PlanFinishReason =
  | 'completed'
  | 'steps_exhausted'
  | 'replan_exhausted'
  | 'plan_exhausted'
  | 'stalled'
  | 'unavailable'
  | 'aborted';

export interface RawStep {
  seqId: number;
  taskName: string;
  content: string;
  coreAction: string;
  type: string;
}

export interface PlanStep {
  seqId: number;
  taskName: string;
  content: string;

  coreActionLabel: string;
  /** 对内：完整工具名（原样大小写，唯一键）；MUST NOT 存归一键 */
  coreAction: string;
  type: StepType;
  dependTools: string[];

  status: StepStatus;
  coreActionOk: boolean;
  attempts: number;
  lastCoreActionTurn: number;
  retryableStreak: number;
}

/**
 * 计划进度（028 FR-034）：单行进度条的唯一数据形状。
 *
 * 只带「当前步」——MUST NOT 携带计划正文、失败原因或工具结果（FR-030 / FR-031）。
 * `phase` 三态：`running` 进入某步 / `replanned` 重规划整批替换后进入新步 / `done` 本轮收尾。
 */
export type PlanProgressPhase = 'running' | 'replanned' | 'done';

export interface PlanProgress {
  seqId: number;
  /** 步名（`taskName`），不是模型原话 */
  label: string;
  phase: PlanProgressPhase;
}

export interface PlanState {
  goal: string;
  queue: PlanStep[];
  current: PlanStep | null;

  doneSummary: string[];

  turnIndex: number;
  totalSteps: number;
  /** 正常滚动次数（队列耗尽后再次规划），不设独立上限 */
  rollCount: number;
  /** 失败驱动重规划次数，上限 6 */
  replanCount: number;
  planRetryCount: number;

  idleTurns: number;
  lastFingerprint: string;

  /** 钩子幂等 */
  seenCallIds: Set<string>;
  extraCalls: string[];
}

export interface CheckFailure {
  code: string;
  seqId: number | null;
  field: string | null;
  detail: string;
}
