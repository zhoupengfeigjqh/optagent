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
 */
import type { Logger } from 'pino';
import type { FileReference, HistoryMessage, LlmEvent, ModelSelection, PoolKey, UsageInfo, UsageStore } from '../types.js';
import type { HistoryStore } from './history.js';
import type { InteractionSink, InteractionSnapshot } from './interaction-gate.js';
import { validateInteractionArgs } from './interaction-schema.js';
import { genMessageId, toSeconds } from './message-format.js';
import { buildPromptMessages } from './prompt-builder.js';
import type { ResolveInteractionResult, RunState, SsePayload } from './run-events.js';
import { RunImpl, type Run } from './run-impl.js';
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
  /** 工具调用记录（可选）：装配后落 `tool-events.jsonl` 并按预算回灌；缺省 = 不落盘不回灌 */
  toolEvents?: ToolEventStore;
  /** 后台计算结果清单（R11，可选）：无产出时 MUST 返回空串（§10.6 不变式 5）。缺省 = 不注入 */
  produced?: (userId: string, threadId: string) => Promise<string>;
}

export class RunManager {
  private readonly active = new Map<string, RunImpl>();
  /**
   * 并发额度占位（threadId → userId）：已过 acquireQuota、但实例尚未就绪的启动请求；
   * 把「并发判定」与「run 注册」之间的 await 窗口封闭掉，杜绝超发。
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
    this.reserving.delete(opts.threadId); // 额度占位转正为活跃 run
    this.active.set(opts.threadId, run);
    run.settled = this.consume(run, opts).catch((err: unknown) => {
      // consume 内部已兜底；此处防御性吞掉，保证 settled 不 reject
      this.deps.logger?.error({ err, event: 'run.consume.unhandled' }, 'run 收尾异常');
    });
    return run;
  }

  /** 读素材并交给纯函数拼装本轮 prompt（拼装规则与理由见 `prompt-builder.ts`） */
  private async buildPrompt(
    opts: StartRunOptions,
    userMessage: HistoryMessage,
  ): Promise<{ messages: HistoryMessage[]; systemExtra?: string }> {
    const { userId, threadId } = opts;
    return buildPromptMessages({
      threadId,
      summaryData: this.deps.summary?.read(userId, threadId) ?? { summary: '', coveredCount: 0 },
      allMessages: this.deps.history.readAll(userId, threadId),
      userMessage,
      records: this.deps.toolEvents?.readAll(userId, threadId) ?? [],
      producedText: (await this.deps.produced?.(userId, threadId)) ?? '',
    });
  }

  private async consume(run: RunImpl, opts: StartRunOptions): Promise<void> {
    const { userId, threadId, agent, thinking } = opts;
    const userMessage: HistoryMessage = { role: 'user', content: opts.userMessage };
    if (opts.attachments && opts.attachments.length > 0) userMessage.attachments = opts.attachments;
    const { messages, systemExtra } = await this.buildPrompt(opts, userMessage);
    /**
     * 本轮结局：供收尾日志使用（任务 2026-09-16）。
     *
     * 为什么要有这一条：关闭逐请求访问日志后，agent 侧只剩"崩溃"能查到，
     * **正常/失败的一轮在日志里没有任何痕迹**——"回答很慢""这轮失败了"
     * 只能靠复现。`run.end` 每轮一行（含 ok / duration_ms / error_code），
     * 既是排障入口，也是"业务是否正常"的最直接信号。
     */
    let outcome: { ok: boolean; error_code?: string } = { ok: false, error_code: 'INTERNAL_ERROR' };
    try {
      for await (const ev of agent.run({
        threadId,
        messages,
        ...(systemExtra ? { systemExtra } : {}),
        thinking,
        ...(opts.model ? { model: opts.model } : {}),
        signal: run.controller.signal,
        interactionSink: run.gate,
      })) {
        switch (ev.type) {
          case 'thinking_delta':
            run.emit({ type: 'thinking', data: { delta: ev.delta } });
            break;
          case 'content_delta':
            run.buffer += ev.delta;
            run.emit({ type: 'content', data: { delta: ev.delta } });
            break;
          case 'tool_call_start': {
            const startedAtMs = this.now();
            const startedAt = new Date(startedAtMs).toISOString();
            run.toolCalls.set(ev.callId, { name: ev.name, startedAt, startedAtMs });
            // 落 tool-events.jsonl（写盘失败只告警，不影响对话，见 appendStart 内部兜底）
            this.deps.toolEvents?.appendStart(userId, threadId, {
              callId: ev.callId,
              messageId: run.assistantMessageId,
              name: ev.name,
              startedAt,
              ...(ev.argsDigest ? { argsDigest: ev.argsDigest } : {}),
            });
            run.emit({ type: 'tool_call', data: { call_id: ev.callId, name: ev.name, status: 'running' } });
            break;
          }
          case 'tool_call_end': {
            const meta = run.toolCalls.get(ev.callId);
            run.toolCalls.delete(ev.callId);
            const endedAtMs = this.now();
            // fire-and-forget：落盘不阻塞 SSE，失败也不影响本轮回答（原则九）
            void this.deps.toolEvents?.appendEnd(userId, threadId, {
              callId: ev.callId,
              messageId: run.assistantMessageId,
              name: meta?.name ?? ev.name,
              startedAt: meta?.startedAt ?? new Date(endedAtMs).toISOString(),
              status: ev.status,
              durationMs: meta ? Math.max(0, endedAtMs - meta.startedAtMs) : 0,
              resultText: ev.resultText ?? '',
            });
            run.emit({ type: 'tool_call_end', data: { call_id: ev.callId, status: ev.status } });
            break;
          }
          case 'done':
            await this.finalizeDone(run, opts, userMessage, ev.usage);
            outcome = { ok: true };
            return;
          case 'error':
            if (ev.code === 'ABORTED') {
              this.finalizeAborted(run, opts, ev.usage);
              outcome = { ok: false, error_code: 'ABORTED' };
              return;
            }
            await this.finalizeError(run, opts, userMessage, ev);
            outcome = { ok: false, error_code: ev.code };
            return;
        }
      }
      // 流无终结事件而结束 → 视为错误
      run.state = 'error';
      outcome = { ok: false, error_code: 'LLM_ERROR' };
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
      outcome = { ok: false, error_code: 'INTERNAL_ERROR' };
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
      // HITL：run 结束清理全部挂起状态（含 expired 留档与排队等待者）
      run.gate.dispose();
      const durationMs = this.now() - run.startedAt;
      this.deps.logger?.[outcome.ok ? 'info' : 'warn'](
        {
          event: 'run.end',
          scope: 'run',
          ok: outcome.ok,
          duration_ms: durationMs,
          ...(outcome.error_code ? { error_code: outcome.error_code } : {}),
          user_id: userId,
          thread_id: threadId,
          agent_name: run.agentName,
        },
        `对话轮次结束：${outcome.ok ? '成功' : `失败（${outcome.error_code ?? '未知'}）`}，耗时 ${durationMs}ms`,
      );
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
    const userMessageId = genMessageId(nowMs);
    // assistant 消息 id 用 run 启动时预生成的那个：工具事件行已按它归属
    const assistantId = run.assistantMessageId;
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
        id: userMessageId,
        ts,
        agent_name: run.agentName,
      }),
      this.deps.history.append(opts.userId, opts.threadId, assistantMessage),
      // 工具记录同样"先落盘后广播"：否则 done 到达时前端立即刷新会读不到工具卡片
      this.deps.toolEvents?.flush(opts.userId, opts.threadId) ?? Promise.resolve(),
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
      // 失败轮同样等工具记录落盘（工具可能已成功执行过，卡片不该丢）
      this.deps.toolEvents?.flush(opts.userId, opts.threadId) ?? Promise.resolve(),
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
