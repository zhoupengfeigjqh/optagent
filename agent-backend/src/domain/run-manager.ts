/**
 * Run 生命周期管理（T022 / FR-025/026/027/030 + 002 特性）。
 *
 * - 每 thread 单活跃 run；事件总线广播（SSE 订阅者 + 内部落盘器）
 * - 断连 = 仅退订，run 照跑落盘；stop = AbortController 中断，丢弃本轮但记 usage
 * - 工具调用：SSE 仅转发工具名与状态；**结果落 `tool-events.jsonl`**
 *   （入参只留短标量摘要）供刷新后展示与下一轮受控回灌
 * - 下一轮：按预算把内联结果回灌进对应轮次的 assistant 消息，
 *   外置结果只在 systemExtra 留一行索引（见 domain/tool-context.ts）
 * - done：整轮耗时 + message_id + agent_name 广播；user+assistant 带元数据落盘（先落盘后广播）+ usage 记录
 * - error：失败轮落 status='failed' 消息行（含错误信息与已消耗 usage/耗时）
 * - 思考内容仅实时广播，不落历史（FR-006/009）
 * - 未知异常 → error + onCrash（上层销毁实例）
 * - beginDrain（关机）：进行中 run 标记 draining，当前消息写完收尾
 *
 * 007 拆分：四个收尾入口（`finalizeDone` / `finalizeError` / `finalizeAborted` / `recordUsage`）
 * **纯搬运**到 `run-finalize.ts`，本文件只留编排（并发配额、活跃表、prompt 装配、事件分派）。
 */
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
import type { IntentFocusPort } from './intent-focus-runner.js';
import type { ToolEventStore } from './tool-events.js';

// 类型迁移到 run-events / run-impl 后仍从本模块转出：既有引用路径（routes、测试）不变
export type { ResolveInteractionResult, RunState, SsePayload, Run };

export interface AgentRunRequest {
  threadId: string;
  messages: HistoryMessage[];
  /** 追加到实例 System Prompt 之后的动态片段（如滚动摘要，FR-017） */
  systemExtra?: string;
  thinking: boolean;
  /** 请求级模型覆盖（缺省用实例默认模型） */
  model?: ModelSelection;
  signal: AbortSignal;
  /** 人工确认交互口（HITL）：给声明了 confirmation 策略的 MCP 工具包交互门；缺省则直跑 */
  interactionSink?: InteractionSink;
  /**
   * 007：本轮可用工具清单的**回填出口**。
   *
   * 装配工具的地方（`infra/agent-factory.runWith`）才是"模型到底能用哪些工具"的唯一权威来源；
   * 域层（轮末定稿「下一步动作提示」）需要这份清单来裁剪模型给出的工具引用，故由装配方写回。
   * 缺省 = 调用方不关心；直聊分支（无工具）保持空数组。
   */
  runtime?: RunRuntime;
  /**
   * 007 修订（Tail Protocol）：本轮「下一步动作提示」的条数上限。
   * 存在 = 该数字人开关已开启，`agent-factory` 据此在 System Prompt 末尾追加尾部块指令
   * （工具目录取本轮真实装配清单）；缺省 = 不追加（模型不感知该协议）。
   */
  nextActionsMax?: number;
  /**
   * 013：意图聚焦判定口。
   *
   * 存在 = 该数字人开关开启且判定模型已配置；由 `agent-factory` 在**工具装配之后、
   * 模型调用之前**回调，返回的非空提示追加到本轮 `systemExtra` 末尾。
   *
   * 为什么在装配期回调：候选工具清单（`runtime.availableTools`）只有装配方才拿得到，
   * 它是"本轮模型真实可用工具"的唯一权威来源；域层另算一份必然与真实工具漂移。
   */
  focusJudge?: (tools: ReadonlyArray<{ name: string; description: string }>) => Promise<string>;
}

/** run-manager 视角的 Agent 实例（PoolStore 的 PooledInstance 超集，由 infra 装配） */
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
  thinking: boolean;
  /** @ 文件引用（随 user 消息落盘；提交 LLM 时追加引用段） */
  attachments?: FileReference[];
  /** 请求级模型覆盖 */
  model?: ModelSelection;
  /**
   * 本轮请求级指引（004：问题实例关联工具的隐藏引导）。
   * 只进本轮 System Prompt 追加段，**不落盘、不进历史**——用户消息气泡因此保持干净。
   */
  guidance?: string;
  /**
   * 013：本轮跳过意图聚焦（预置动作入口：下一步动作卡片 / 首屏问题实例卡片）。
   *
   * 由请求体 `skip_intent_focus` 透传；服务端可校验，不依赖前端"少发一次请求"。
   * 只影响本轮判定，不落历史、不改变 SSE 序列。
   */
  skipIntentFocus?: boolean;
}

export interface RunManagerDeps {
  history: HistoryStore;
  usage: UsageStore;
  logger?: Logger;
  /** 滚动摘要（FR-017/018）：注入 System Prompt + 每轮结束触发增量重写；009：落点按（用户，数字人，会话）解析 */
  summary?: {
    read(
      userId: string,
      agentName: string,
      threadId: string,
    ): { summary: string; coveredCount: number };
    trigger(userId: string, agentName: string, threadId: string): Promise<void>;
  };
  /** run 未知异常（疑似实例崩溃）回调：上层销毁池内实例（FR-030） */
  onCrash?: (key: PoolKey, err: unknown) => void;
  /** 注入时钟（测试用） */
  now?: () => number;
  /** 工具调用记录（可选）：装配后落 `tool-events.jsonl` 并按预算回灌；缺省 = 不落盘不回灌 */
  toolEvents?: ToolEventStore;
  /** 后台计算结果清单（R11，可选）：无产出时 MUST 返回空串（§10.6 不变式 5）。缺省 = 不注入 */
  produced?: (userId: string, agentName: string, threadId: string) => Promise<string>;
  /**
   * 007 修订「下一步动作提示」（可选）：轮开始 `clear`、轮末 `finalize`。
   * 缺省 = 该侧未装配，功能整体不生效（与开关关闭同一效果）。
   */
  nextActions?: Pick<NextActionsStore, 'clear' | 'finalize'>;
  /**
   * 007 修订：某数字人的「下一步动作提示」配置（读 SOUL.md frontmatter，逐次现读）。
   * `null` = 开关关闭（不追加尾部块指令、收尾不定稿卡片）；开启时带条数上限。
   */
  nextActionsConfig?: (
    userId: string,
    agentName: string,
  ) => { enabled: boolean; max: number } | null;
  /**
   * 2026-10-15：LLM 身份取值口（`provider` / 默认 `model`），由装配处注入。
   * 缺省 = 失败日志少记这两列（收尾与落盘不受影响）。
   */
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
  /**
   * 启动中请求的取消标记（2026-10-27）：占位已拿、run 还没注册时收到的 stop / 删会话。
   * 由 `takeCancel` 一次性消费，`startRun` 转正时也会清掉（防幽灵取消）。
   */
  private readonly cancelRequested = new Set<string>();
  private draining = false;
  private readonly now: () => number;
  /** 轮次收尾家族（007 拆分出去；只依赖落盘/记账/后台触发器，见 run-finalize.ts） */
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

  /** 该 thread 是否已有进行中（或正在启动）的 run */
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

  /** 进行中的 run 数（不含启动中占位；监控指标口径） */
  activeRunCount(): number {
    return this.active.size;
  }

  /**
   * 尚未收尾的请求数（活跃 run + 启动中占位，2026-10-27）：优雅关闭的等待口径。
   *
   * 启动中占位横跨「取实例 + 等 MCP 就绪」，最长可达数秒；只等 `active` 会在
   * 占位转正的瞬间判定"已排空"，导致关服与新一轮开跑赛跑。
   */
  inFlightCount(): number {
    return this.active.size + this.reserving.size;
  }

  /**
   * 原子占用一个并发额度：**同步**完成「检查 + 占位」，两步之间无 await，
   * 因此同一用户的并发请求不可能同时通过判定。
   *
   * 这是 THREAD_BUSY_LIMIT 的唯一判定入口。调用方拿到额度后若因异常
   * 未走到 startRun（如取实例失败），**必须调用返回的归还函数**，
   * 否则占位会一直占用该用户的并发额度。
   *
   * @returns 幂等归还函数；startRun 转正后调用为 no-op（不会误删活跃 run）
   */
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

  /**
   * 取走"启动中取消"标记（2026-10-27）。
   *
   * `acquireQuota` 与 `startRun` 之间最长有数秒 await（取实例 / 等 MCP 就绪）。
   * 这段时间里的 stop / 删会话必须能取消掉这一轮，否则用户点了停止、界面也断流了，
   * 后端随后照样开跑并落一条谁也看不见的回答；删会话更糟——run 会把刚删的目录重建出来。
   *
   * 由发起请求的一方在 `startRun` 前调用（一次性消费）。
   */
  takeCancel(threadId: string): boolean {
    return this.cancelRequested.delete(threadId);
  }

  /** 关机 draining：进行中 run 标记 draining（当前消息写完收尾，不新开步骤） */
  beginDrain(): void {
    this.draining = true;
    for (const run of this.active.values()) {
      if (run.state === 'running') run.state = 'draining';
    }
  }

  isDraining(): boolean {
    return this.draining;
  }

  /**
   * 中断该会话的这一轮：已注册的 run 直接 stop；仍在启动中的请求打取消标记
   * （2026-10-27）。后者若不处理，用户"停止"后本轮照样开跑并落一条看不见的回答。
   */
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

  /** 当前等待确认的 interaction 快照（断连恢复用；无进行中 run 或无所待则为 null） */
  pendingInteractionOf(threadId: string): InteractionSnapshot | null {
    const run = this.active.get(threadId);
    if (!run) return null;
    return run.gate.snapshot();
  }

  /** 宽限期到：中断全部进行中 run（尽力落盘交给各自 finalize） */
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
    // 2026-10-15：本轮实际模型（请求级覆盖优先）——LLM 失败日志据此定位到具体模型
    if (opts.model) run.modelId = opts.model.model;
    this.reserving.delete(opts.threadId); // 额度占位转正为活跃 run
    // 转正即清取消标记：启动窗口内没收到 stop，这轮就是正常一轮（防幽灵取消影响后续轮次）
    this.cancelRequested.delete(opts.threadId);
    this.active.set(opts.threadId, run);
    // 007 修订：新一轮开始即清空上一轮的「下一步动作提示」快照（同步，无独立生成链后无顺序竞态）。
    // 语义不变：发起新一轮的瞬间上一轮卡片即消失（前端 onSend 的 reset 与之同刻）。
    this.deps.nextActions?.clear(opts.userId, opts.agent.key.agentName, opts.threadId);
    run.settled = this.consume(run, opts).catch((err: unknown) => {
      // consume 内部已兜底；此处防御性吞掉，保证 settled 不 reject
      this.deps.logger?.error({ err, event: 'run.consume.unhandled' }, 'run 收尾异常');
    });
    return run;
  }

  /** 单轮执行（013 拆到 `run-consume.ts`；本文件只留编排） */
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
