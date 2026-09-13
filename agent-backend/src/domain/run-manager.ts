/**
 * Run 生命周期管理（T022 / FR-025/026/027/030 + 002 特性）。
 *
 * - 每 thread 单活跃 run；事件总线广播（SSE 订阅者 + 内部落盘器）
 * - 断连 = 仅退订，run 照跑落盘；stop = AbortController 中断，丢弃本轮但记 usage
 * - 工具调用：仅转发工具名与状态（tool_call/tool_call_end），入参与结果永不透出
 * - done：整轮耗时 + message_id + agent_name 广播；user+assistant 带元数据落盘（先落盘后广播）+ usage 记录
 * - error：失败轮落 status='failed' 消息行（含错误信息与已消耗 usage/耗时）
 * - 思考内容仅实时广播，不落历史（FR-006/009）
 * - 未知异常 → error + onCrash（上层销毁实例）
 * - beginDrain（关机）：进行中 run 标记 draining，当前消息写完收尾
 */
import type { Logger } from 'pino';
import type { FileReference, HistoryMessage, LlmEvent, ModelSelection, PoolKey, UsageInfo, UsageStore } from '../types.js';
import type { HistoryStore } from './history.js';

export type RunState = 'running' | 'draining' | 'done' | 'aborted' | 'error';

/** 广播给订阅者的事件（与 SSE 契约同构） */
export type SsePayload =
  | { type: 'thinking'; data: { delta: string } }
  | { type: 'content'; data: { delta: string } }
  | { type: 'tool_call'; data: { call_id: string; name: string; status: 'running' } }
  | { type: 'tool_call_end'; data: { call_id: string; status: 'success' | 'error' } }
  | {
      type: 'done';
      data: {
        finish_reason: 'stop' | 'completed';
        usage: { input_tokens: number; output_tokens: number };
        duration_seconds: number;
        /** assistant 落盘消息 ID；stop（本轮丢弃）时为 null */
        message_id: string | null;
        /** 本轮回答的数字人（会话可跨数字人） */
        agent_name: string;
      };
    }
  | {
      type: 'error';
      data: {
        error: { code: string; message: string };
        duration_seconds?: number;
        usage?: { input_tokens: number; output_tokens: number };
        /** 本轮回答的数字人（会话可跨数字人） */
        agent_name: string;
      };
    };

export interface AgentRunRequest {
  threadId: string;
  messages: HistoryMessage[];
  /** 追加到实例 System Prompt 之后的动态片段（如滚动摘要，FR-017） */
  systemExtra?: string;
  thinking: boolean;
  /** 请求级模型覆盖（缺省用实例默认模型） */
  model?: ModelSelection;
  signal: AbortSignal;
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

export interface Run {
  readonly threadId: string;
  readonly state: RunState;
  /** 订阅事件流；返回退订函数（客户端断开时调用，run 不受影响） */
  subscribe(cb: (e: SsePayload) => void): () => void;
  stop(): void;
  /** 收尾完成（含落盘与 usage 记录）后 resolve；永不 reject */
  readonly settled: Promise<void>;
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
}

export interface RunManagerDeps {
  history: HistoryStore;
  usage: UsageStore;
  logger?: Logger;
  /** 滚动摘要（FR-017/018）：注入 System Prompt + 每轮结束触发增量重写 */
  summary?: {
    read(userId: string, threadId: string): { summary: string; coveredCount: number };
    trigger(userId: string, threadId: string): Promise<void>;
  };
  /** run 未知异常（疑似实例崩溃）回调：上层销毁池内实例（FR-030） */
  onCrash?: (key: PoolKey, err: unknown) => void;
  /** 注入时钟（测试用） */
  now?: () => number;
}

class RunImpl implements Run {
  state: RunState = 'running';
  readonly controller = new AbortController();
  buffer = '';
  settled!: Promise<void>;
  /** run 开始时间（注入时钟），用于整轮耗时统计 */
  startedAt = 0;
  private readonly subs = new Set<(e: SsePayload) => void>();

  constructor(
    readonly threadId: string,
    readonly userId: string,
    readonly agentName: string,
  ) {}

  subscribe(cb: (e: SsePayload) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  emit(e: SsePayload): void {
    for (const cb of [...this.subs]) {
      try {
        cb(e);
      } catch {
        /* 订阅者异常不影响其他订阅者与落盘器 */
      }
    }
  }

  stop(): void {
    this.controller.abort();
  }
}

/** 消息 ID：m_{base36时间戳}_{4位随机} */
function genMessageId(now: number): string {
  return `m_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 引用段文本：提交给 LLM 时追加在 user content 末尾（历史行本体保持纯净）。
 *  统一只给 user-data 相对路径：内置工具与 MCP 工具（file_args 转换）同口径 */
function refsText(attachments: FileReference[]): string {
  return `\n[引用文件] ${attachments.map((a) => `${a.dir}/${a.filename}`).join('；')}`;
}

/** LLM 上下文消息：user 消息若有 @ 引用则追加引用段 */
function toLlmContent(m: HistoryMessage): string {
  return m.attachments && m.attachments.length > 0 ? m.content + refsText(m.attachments) : m.content;
}

function toSeconds(ms: number): number {
  return Math.round(ms) / 1000;
}

export class RunManager {
  private readonly active = new Map<string, RunImpl>();
  /**
   * 并发额度占位（threadId → userId）：已通过 acquireQuota 校验、
   * 但 agent 实例尚未就绪（仍在校验/装配中）的启动请求。
   * 作用是把「并发判定」与「run 注册」之间的 await 窗口封闭掉，杜绝超发。
   */
  private readonly reserving = new Map<string, string>();
  private draining = false;
  private readonly now: () => number;

  constructor(private readonly deps: RunManagerDeps) {
    this.now = deps.now ?? Date.now;
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
    };
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

  stop(threadId: string): boolean {
    const run = this.active.get(threadId);
    if (!run) return false;
    run.stop();
    return true;
  }

  /** 宽限期到：中断全部进行中 run（尽力落盘交给各自 finalize） */
  stopAll(): void {
    for (const run of this.active.values()) run.stop();
  }

  startRun(opts: StartRunOptions): Run {
    const existing = this.active.get(opts.threadId);
    if (existing) throw new ThreadRunActiveError(opts.threadId);
    const run = new RunImpl(opts.threadId, opts.userId, opts.agent.key.agentName);
    run.startedAt = this.now();
    this.reserving.delete(opts.threadId); // 额度占位转正为活跃 run
    this.active.set(opts.threadId, run);
    run.settled = this.consume(run, opts).catch((err: unknown) => {
      // consume 内部已兜底；此处防御性吞掉，保证 settled 不 reject
      this.deps.logger?.error({ err, event: 'run.consume.unhandled' }, 'run 收尾异常');
    });
    return run;
  }

  private async consume(run: RunImpl, opts: StartRunOptions): Promise<void> {
    const { userId, threadId, agent, thinking } = opts;
    const userMessage: HistoryMessage = { role: 'user', content: opts.userMessage };
    if (opts.attachments && opts.attachments.length > 0) userMessage.attachments = opts.attachments;
    const messages: HistoryMessage[] = [
      ...this.deps.history.readRecent(userId, threadId, 20),
      userMessage,
    ].map((m) => ({ role: m.role, content: toLlmContent(m) }));
    // FR-017：滚动摘要作为 System Prompt 一部分注入
    const { summary } = this.deps.summary?.read(userId, threadId) ?? { summary: '' };
    const systemExtra = summary ? `以下是对话早期内容的摘要：\n${summary}` : undefined;
    try {
      for await (const ev of agent.run({
        threadId,
        messages,
        ...(systemExtra ? { systemExtra } : {}),
        thinking,
        ...(opts.model ? { model: opts.model } : {}),
        signal: run.controller.signal,
      })) {
        switch (ev.type) {
          case 'thinking_delta':
            run.emit({ type: 'thinking', data: { delta: ev.delta } });
            break;
          case 'content_delta':
            run.buffer += ev.delta;
            run.emit({ type: 'content', data: { delta: ev.delta } });
            break;
          case 'tool_call_start':
            run.emit({ type: 'tool_call', data: { call_id: ev.callId, name: ev.name, status: 'running' } });
            break;
          case 'tool_call_end':
            run.emit({ type: 'tool_call_end', data: { call_id: ev.callId, status: ev.status } });
            break;
          case 'done':
            await this.finalizeDone(run, opts, userMessage, ev.usage);
            return;
          case 'error':
            if (ev.code === 'ABORTED') {
              this.finalizeAborted(run, opts, ev.usage);
              return;
            }
            await this.finalizeError(run, opts, userMessage, ev);
            return;
        }
      }
      // 流无终结事件而结束 → 视为错误
      run.state = 'error';
      run.emit({
        type: 'error',
        data: {
          error: { code: 'LLM_ERROR', message: 'LLM 流异常结束' },
          duration_seconds: toSeconds(this.now() - run.startedAt),
          agent_name: run.agentName,
        },
      });
    } catch (err) {
      // 未知异常：疑似实例崩溃 → 销毁实例（FR-030），下条消息自动重建
      run.state = 'error';
      this.deps.logger?.error(
        { err, alert: true, event: 'agent.crashed', user_id: userId, thread_id: threadId, agent_name: agent.key.agentName },
        'Agent 实例崩溃，已销毁',
      );
      this.deps.onCrash?.(agent.key, err);
      run.emit({
        type: 'error',
        data: {
          error: { code: 'INTERNAL_ERROR', message: '内部错误，请重试' },
          duration_seconds: toSeconds(this.now() - run.startedAt),
          agent_name: run.agentName,
        },
      });
    } finally {
      this.active.delete(threadId);
    }
  }

  private async finalizeDone(
    run: RunImpl,
    opts: StartRunOptions,
    userMessage: HistoryMessage,
    usage: UsageInfo,
  ): Promise<void> {
    run.state = 'done';
    const nowMs = this.now();
    const ts = new Date(nowMs).toISOString();
    const durationMs = nowMs - run.startedAt;
    const userId = genMessageId(nowMs);
    const assistantId = genMessageId(nowMs);
    this.recordUsage(opts, usage);
    // 先落盘后广播 done：SSE 响应随 done 结束，保证调用方拿到响应时历史已可读
    const assistantMessage: HistoryMessage = {
      id: assistantId,
      role: 'assistant',
      content: run.buffer,
      ts,
      status: 'completed',
      usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
      duration_ms: durationMs,
      agent_name: run.agentName,
    };
    await Promise.all([
      this.deps.history.append(opts.userId, opts.threadId, {
        ...userMessage,
        id: userId,
        ts,
        agent_name: run.agentName,
      }),
      this.deps.history.append(opts.userId, opts.threadId, assistantMessage),
    ]);
    run.emit({
      type: 'done',
      data: {
        finish_reason: 'completed',
        usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
        duration_seconds: toSeconds(durationMs),
        message_id: assistantId,
        agent_name: run.agentName,
      },
    });
    // FR-018：窗口外攒满一批则 fire-and-forget 增量重写摘要
    void this.deps.summary?.trigger(opts.userId, opts.threadId);
  }

  /** LLM 错误（非中断）：失败轮落盘（status='failed' + 错误信息 + 已消耗 usage/耗时） */
  private async finalizeError(
    run: RunImpl,
    opts: StartRunOptions,
    userMessage: HistoryMessage,
    ev: { code: string; message: string; usage?: UsageInfo },
  ): Promise<void> {
    run.state = 'error';
    const nowMs = this.now();
    const ts = new Date(nowMs).toISOString();
    const durationMs = nowMs - run.startedAt;
    if (ev.usage) this.recordUsage(opts, ev.usage);
    // FR-011：失败轮留痕（assistant 行 content 为空，错误信息在 error 字段）
    const assistantMessage: HistoryMessage = {
      id: genMessageId(nowMs),
      role: 'assistant',
      content: run.buffer,
      ts,
      status: 'failed',
      duration_ms: durationMs,
      error: { code: ev.code, message: ev.message },
      agent_name: run.agentName,
    };
    if (ev.usage) {
      assistantMessage.usage = { input_tokens: ev.usage.inputTokens, output_tokens: ev.usage.outputTokens };
    }
    await Promise.all([
      this.deps.history.append(opts.userId, opts.threadId, {
        ...userMessage,
        id: genMessageId(nowMs),
        ts,
        agent_name: run.agentName,
      }),
      this.deps.history.append(opts.userId, opts.threadId, assistantMessage),
    ]);
    run.emit({
      type: 'error',
      data: {
        error: { code: ev.code, message: ev.message },
        duration_seconds: toSeconds(durationMs),
        agent_name: run.agentName,
        ...(ev.usage
          ? { usage: { input_tokens: ev.usage.inputTokens, output_tokens: ev.usage.outputTokens } }
          : {}),
      },
    });
  }

  private finalizeAborted(run: RunImpl, opts: StartRunOptions, usage?: UsageInfo): void {
    run.state = 'aborted';
    const u = usage ?? { inputTokens: 0, outputTokens: 0 };
    run.emit({
      type: 'done',
      data: {
        finish_reason: 'stop',
        usage: { input_tokens: u.inputTokens, output_tokens: u.outputTokens },
        duration_seconds: toSeconds(this.now() - run.startedAt),
        message_id: null, // 本轮丢弃，无落盘消息
        agent_name: run.agentName,
      },
    });
    // FR-027：丢弃本轮消息，但已消耗 token 照记
    this.recordUsage(opts, u);
  }

  private recordUsage(opts: StartRunOptions, u: UsageInfo): void {
    this.deps.usage.record({
      userId: opts.userId,
      threadId: opts.threadId,
      agentName: opts.agent.key.agentName,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      createdAt: new Date(this.now()).toISOString(),
    });
  }
}
