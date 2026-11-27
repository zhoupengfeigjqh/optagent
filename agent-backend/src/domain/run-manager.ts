import type { Logger } from 'pino';
import type {
  FileReference,
  HistoryMessage,
  LlmEvent,
  ModelSelection,
  PoolKey,
  RunRuntime,
  UsageStore,
} from '../types.js';
import type { HistoryStore } from './history.js';
import type { InteractionSink, InteractionSnapshot } from './interaction-gate.js';
import { validateInteractionArgs } from './interaction-schema.js';
import { genMessageId } from './message-format.js';
import type { NextActionsStore } from './next-actions.js';
import type { ResolveInteractionResult, RunState, SsePayload } from './run-events.js';
import { RunFinalizer } from './run-finalize.js';
import { RunImpl, type Run } from './run-impl.js';
import { consumeTurn } from './run-consume.js';
import type { IntentFocusPort } from './intent-focus/runner.js';
import type { FocusToolTip } from './intent-focus/types.js';
import type { ToolEventStore } from './tool-events.js';

export type { ResolveInteractionResult, RunState, SsePayload, Run };

export interface AgentRunRequest {
  threadId: string;
  messages: HistoryMessage[];
  systemExtra?: string;
  thinking: boolean;
  model?: ModelSelection;
  signal: AbortSignal;
  interruptRun?: () => void;
  skill?: string;
  interactionSink?: InteractionSink;
  runtime?: RunRuntime;
  /**
   * 007 修订（Tail Protocol）：本轮「下一步动作提示」的条数上限。
   * 存在 = 该数字人开关已开启，`agent-factory` 据此在 System Prompt 末尾追加尾部块指令
   * （候选目录取 `focusToolTips`）；缺省 = 不追加（模型不感知该协议）。
   */
  nextActionsMax?: number;
  /**
   * 016：本轮意图聚焦选出的本体能力（行为 + 函数）。
   *
   * 既是尾部块指令里的**唯一候选目录**（卡片的 `tool_tips` 只能从这份清单抄），
   * 也是"本轮能不能产卡片"的判据（空 = 不追加指令、不产卡片）。
   */
  focusToolTips?: readonly FocusToolTip[];
  focusPrompt?: string;
  /**
   * 028：规划门禁分数（0~1）。
   *
   * 缺席 = 没判（门禁关闭 / 数字人未开规划 / 判定失败）→ 按 fail-open 走规划。
   */
  planScore?: number;
}

export interface RunAgentLike {
  readonly key: PoolKey;
  activeThreads: number;
  run(req: AgentRunRequest): AsyncIterable<LlmEvent>;
}

export class ThreadRunActiveError extends Error {
  readonly code = 'THREAD_RUN_ACTIVE';
  constructor(threadId: string) {
    super(`对话 ${threadId} 已有进行中的回复，请等本轮结束后再发送`);
    this.name = 'ThreadRunActiveError';
  }
}

/** 同一用户并发额度已满（跨数字人累计）；上层映射 409 THREAD_BUSY_LIMIT */
export class ThreadBusyLimitError extends Error {
  readonly code = 'THREAD_BUSY_LIMIT';
  constructor(limit: number) {
    super(`当前并发对话已达上限（${limit}），请稍后再试`);
    this.name = 'ThreadBusyLimitError';
  }
}

export interface StartRunOptions {
  userId: string;
  threadId: string;
  agent: RunAgentLike;
  userMessage: string;
  displayContent?: string;
  thinking: boolean;
  attachments?: FileReference[];
  skill?: string;
  model?: ModelSelection;
  guidance?: string;
  skipIntentFocus?: boolean;
  toolTips?: readonly FocusToolTip[];
}

export interface RunManagerDeps {
  history: HistoryStore;
  usage: UsageStore;
  logger?: Logger;
  summary?: {
    read(
      userId: string,
      agentName: string,
      threadId: string,
    ): { summary: string; coveredCount: number };
    trigger(userId: string, agentName: string, threadId: string): Promise<void>;
  };
  onCrash?: (key: PoolKey, err: unknown) => void;
  now?: () => number;
  toolEvents?: ToolEventStore;
  produced?: (userId: string, agentName: string, threadId: string) => Promise<string>;
  nextActions?: Pick<NextActionsStore, 'clear' | 'finalize'>;
  /**
   * 007 修订：某数字人的「下一步动作提示」配置（读 SOUL.md frontmatter，逐次现读）。
   * `null` = 开关关闭（不追加尾部块指令、收尾不定稿卡片）；开启时带条数上限。
   */
  nextActionsConfig?: (
    userId: string,
    agentName: string,
  ) => { enabled: boolean; max: number } | null;
  llmInfo?: () => { provider: string; model: string };
  /**
   * 013：意图聚焦判定口（可选）。
   * 缺省 = 未装配（等同功能不可用）；是否存在由装配处按配置决定，
   * 每轮是否真正判定还要看该数字人 SOUL 开关（开关判定在 runner 内部完成）。
   */
  intentFocus?: IntentFocusPort;
}

export class RunManager {
  private readonly active = new Map<string, RunImpl>();
  /**
   * 并发额度占位（threadId → userId）：已过 acquireQuota、但实例尚未就绪的启动请求；
   * 把「并发判定」与「run 注册」之间的 await 窗口封闭掉，杜绝超发。
   */
  private readonly reserving = new Map<string, string>();
  private readonly cancelRequested = new Set<string>();
  private draining = false;
  private readonly now: () => number;
  private readonly finalizer: RunFinalizer;

  constructor(private readonly deps: RunManagerDeps) {
    this.now = deps.now ?? Date.now;
    this.finalizer = new RunFinalizer({
      history: deps.history,
      usage: deps.usage,
      ...(deps.logger ? { logger: deps.logger } : {}),
      ...(deps.toolEvents ? { toolEvents: deps.toolEvents } : {}),
      ...(deps.summary ? { summary: deps.summary } : {}),
      ...(deps.nextActions ? { nextActions: deps.nextActions } : {}),
      ...(deps.llmInfo ? { llmInfo: deps.llmInfo } : {}),
      now: this.now,
    });
  }

  hasActive(threadId: string): boolean {
    return this.active.has(threadId) || this.reserving.has(threadId);
  }

  /**
   * 该用户当前占用的并发额度（THREAD_BUSY_LIMIT 判定）。
   * 口径为 userId（**跨数字人累计**）：用户 exit 后切到另一个数字人，
   * 前一个数字人的进行中 run 仍占额度。
   * 含"已占位未转正"的启动中请求——否则并发判定会漏算（见 acquireQuota）。
   */
  activeThreadCount(userId: string): number {
    let n = 0;
    for (const run of this.active.values()) {
      if (run.userId === userId) n++;
    }
    for (const uid of this.reserving.values()) {
      if (uid === userId) n++;
    }
    return n;
  }

  activeRunCount(): number {
    return this.active.size;
  }

  inFlightCount(): number {
    return this.active.size + this.reserving.size;
  }

  acquireQuota(userId: string, threadId: string, limit: number): () => void {
    if (this.active.has(threadId) || this.reserving.has(threadId)) {
      throw new ThreadRunActiveError(threadId);
    }
    if (this.activeThreadCount(userId) >= limit) {
      throw new ThreadBusyLimitError(limit);
    }
    this.reserving.set(threadId, userId);
    return () => {
      this.reserving.delete(threadId);
      // 取消标记随之清掉：请求已放弃，不能留给下一轮（否则下一轮会被"幽灵取消"）
      this.cancelRequested.delete(threadId);
    };
  }

  takeCancel(threadId: string): boolean {
    return this.cancelRequested.delete(threadId);
  }

  beginDrain(): void {
    this.draining = true;
    for (const run of this.active.values()) {
      if (run.state === 'running') run.state = 'draining';
    }
  }

  isDraining(): boolean {
    return this.draining;
  }

  stop(threadId: string): boolean {
    const run = this.active.get(threadId);
    if (run) {
      run.stop();
      return true;
    }
    if (this.reserving.has(threadId)) {
      this.cancelRequested.add(threadId);
      return true;
    }
    return false;
  }

  async awaitIdle(threadId: string, timeoutMs: number): Promise<boolean> {
    const run = this.active.get(threadId);
    if (run === undefined) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run.settled.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * 用户提交/拒绝一个待确认的 interaction（HITL）。
   * 校验 + 落定一体：submit 先按挂起时的 inputSchema 终验 args（防绕过），
   * 失败不落定（用户可修正后重提）。幂等：重复提交返回首次结果。
   */
  resolveInteraction(
    threadId: string,
    interactionId: string,
    action: 'submit' | 'reject',
    args?: Record<string, unknown>,
  ): ResolveInteractionResult {
    const run = this.active.get(threadId);
    if (!run) return { ok: false, code: 'NOT_FOUND', message: '该会话没有进行中的调用确认' };
    const pending = run.gate.pendingOf(interactionId);
    if (!pending) {
      return { ok: false, code: 'NOT_FOUND', message: `interaction 不存在：${interactionId}` };
    }
    if (pending.state === 'expired') {
      return { ok: false, code: 'EXPIRED', message: '该调用的确认等待已超时，请让数字人重新发起' };
    }
    if (action === 'submit') {
      const errors = validateInteractionArgs(pending.payload.schema, args ?? {});
      if (errors.length > 0) {
        return { ok: false, code: 'VALIDATION_FAILED', message: errors.join('；'), errors };
      }
    }
    const settled = run.gate.settle(interactionId, action, args);
    if (settled.result === 'not-found') {
      return { ok: false, code: 'NOT_FOUND', message: `interaction 不存在：${interactionId}` };
    }
    if (settled.result === 'expired') {
      return { ok: false, code: 'EXPIRED', message: '该调用的确认等待已超时，请让数字人重新发起' };
    }
    return { ok: true, result: settled.result };
  }

  pendingInteractionOf(threadId: string): InteractionSnapshot | null {
    const run = this.active.get(threadId);
    if (!run) return null;
    return run.gate.snapshot();
  }

  stopAll(): void {
    for (const run of this.active.values()) run.stop();
  }

  startRun(opts: StartRunOptions): Run {
    const existing = this.active.get(opts.threadId);
    if (existing) throw new ThreadRunActiveError(opts.threadId);
    const run = new RunImpl(
      opts.threadId,
      opts.userId,
      opts.agent.key.agentName,
      // 交互审计：挂起/提交/拒绝/超时/中断收尾都落结构化日志（args 不落敏感值，键名在负载里）
      (message) =>
        this.deps.logger?.info(
          { event: 'interaction', thread_id: opts.threadId, user_id: opts.userId },
          message,
        ),
    );
    run.startedAt = this.now();
    run.assistantMessageId = genMessageId(run.startedAt);
    if (opts.model) run.modelId = opts.model.model;
    this.reserving.delete(opts.threadId);
    this.cancelRequested.delete(opts.threadId);
    this.active.set(opts.threadId, run);
    // 007 修订：新一轮开始即清空上一轮的「下一步动作提示」快照（同步，无独立生成链后无顺序竞态）。
    this.deps.nextActions?.clear(opts.userId, opts.agent.key.agentName, opts.threadId);
    run.settled = this.consume(run, opts).catch((err: unknown) => {
      // consume 内部已兜底；此处防御性吞掉，保证 settled 不 reject
      this.deps.logger?.error({ err, event: 'run.consume.unhandled' }, 'run 收尾异常');
    });
    return run;
  }

  private async consume(run: RunImpl, opts: StartRunOptions): Promise<void> {
    return consumeTurn(
      {
        deps: this.deps,
        now: this.now,
        finalizer: this.finalizer,
        onSettled: (threadId) => this.active.delete(threadId),
      },
      run,
      opts,
    );
  }
}
