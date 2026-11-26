/**
 * 多步任务规划（028）的共享类型与配置常量。
 *
 * 口径来源：`specs/028-task-planning/data-model.md` §2/§3/§4/§5。
 * 本文件**只有类型与常量**，无逻辑、无 IO。
 *
 * 三条硬约束在这里体现：
 * 1. `coreAction` 存**原样完整工具名**（不是归一键、不是裸名）——SDK 按
 *    `t.name === toolCall.name` 精确匹配，存归一键会导致「一个工具都调不到」；
 * 2. `BUILTIN_TOOL_NAMES` 取自 `builtinToolNames()` 唯一来源，MUST NOT 硬编码清单；
 * 3. 滚动与失败重规划**分开计数**：`ROLL_MAX_PER_RUN` 无上限，`REPLAN_MAX_PER_RUN` 为 6。
 */
import { builtinToolNames } from '../builtin-tool-catalog.js';

/** 单批最少步数（首次规划返回 0 步 = 无需工具，见 `FR-004a`） */
export const PLAN_MIN_STEPS = 1;

/** 单批最多步数 */
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

/** `doneSummary` 保留条数 */
export const SUMMARY_KEEP = 5;

/** 计划快照总字数上限 */
export const SNAPSHOT_MAX_CHARS = 1200;

/**
 * 规划调用超时（毫秒）。
 *
 * 2026-11-26 由 **5s** 提高到 **20s**：规划 system prompt 含全量本体索引 + 全工具清单 +
 * 前置约束，冷启动或慢网络下 5s 会把"正常但偏慢"的调用误判成超时。
 *
 * 与之配套：**超时不再计入重试**（见 `plan-orchestrator.requestBatch`）——超时的原因是"慢"，
 * 原样再发两次大概率还是慢，只会把首字延迟按倍数放大。最坏等待因此收敛为单次 20s。
 */
export const PLAN_TIMEOUT_MS = 20_000;

/** 规划输入携带的历史轮数（1 轮 = user + assistant） */
export const HISTORY_TURNS = 3;

/** 每一步都必须可见的内置工具（取自目录唯一来源，新增内置工具自动生效） */
export const BUILTIN_TOOL_NAMES: readonly string[] = builtinToolNames();

/** 步骤类型：后端推导，LLM 输出仅作比对 */
export type StepType = 'command' | 'query' | 'function';

/** 步骤状态（`done` 为终态，禁止回退） */
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** 工具调用的三态归类 + 不计入三态 */
export type ToolOutcome = 'success' | 'retryable' | 'failed' | 'ignored';

/** 计划终止原因（写进 `plan.finished.reason`） */
export type PlanFinishReason =
  | 'completed'
  | 'steps_exhausted'
  | 'replan_exhausted'
  | 'plan_exhausted'
  | 'stalled'
  | 'unavailable'
  | 'aborted';

/** LLM 原始输出的一条步骤（字段名与提示词一致，不做重命名） */
export interface RawStep {
  /** LLM 填，后端会重排 */
  seqId: number;
  taskName: string;
  content: string;
  /** 裸工具名（无服务前缀） */
  coreAction: string;
  /** LLM 填，仅作比对 */
  type: string;
}

/** 归一化后的步骤（内部权威） */
export interface PlanStep {
  /** run 级自增，跨批连续 */
  seqId: number;
  taskName: string;
  content: string;

  /** 对外：裸名（原样大小写，无服务前缀），用于展示与快照 */
  coreActionLabel: string;
  /** 对内：完整工具名（原样大小写，唯一键）；MUST NOT 存归一键 */
  coreAction: string;
  /** 后端推导 */
  type: StepType;
  /** 后端推导，完整工具名 */
  dependTools: string[];

  status: StepStatus;
  /** 该步 `coreAction` 是否成功过 */
  coreActionOk: boolean;
  /** `coreAction` 调用次数（含重试） */
  attempts: number;
  /** 最后一次 `coreAction` 所在 turn；未调用为 -1 */
  lastCoreActionTurn: number;
  /** 连续 `retryable` 次数（成功即清零；达 3 次转失败，见 FR-022） */
  retryableStreak: number;
}

/** 计划整体状态（run 级，每轮新建、轮末丢弃） */
export interface PlanState {
  /** 后端生成：本轮用户原话截断 ≤40 字 */
  goal: string;
  /** 待办步骤 */
  queue: PlanStep[];
  current: PlanStep | null;

  /** 已完成结论，≤5 条 × 80 字 */
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
  /** 计划外调用（仅观测） */
  extraCalls: string[];
}

/** 一条校验失败项（`checkPlan` 与重试反馈共用同一结构） */
export interface CheckFailure {
  /** `C0`~`C5`（校验）或 `P_*`（解析） */
  code: string;
  /** 出错步骤；批次级失败为 null */
  seqId: number | null;
  /** 出错字段；无具体字段时为 null */
  field: string | null;
  /** 面向模型的说明（进重试反馈） */
  detail: string;
}
