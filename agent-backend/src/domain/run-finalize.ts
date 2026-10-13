/**
 * 轮次收尾家族（007 拆分：`run-manager.ts` 单文件 ≤500 行，宪章原则二）。
 *
 * 一个入口对应一种结局，副作用的**顺序**是这里最要紧的东西：
 *
 * | 入口 | 顺序约束 |
 * |---|---|
 * | `done` | 先定稿卡片（解析尾部块 + 写快照）→ 落盘（用户 + assistant + 工具记录，正文**不含尾部块**）→ 广播 `done`（负载带 `next_actions` 直推）→ fire-and-forget 摘要 |
 * | `error` | 同 `done`：失败轮也要留痕（FR-011），工具记录同样先落盘；失败轮无卡片 |
 * | `aborted` | 只广播 + 记账：本轮消息**丢弃不落盘**，但已消耗 token 照记（FR-027） |
 *
 * 007 修订（Tail Protocol）：卡片与回答**同流产出**，`done` 时刻已就绪——
 * 卡片定稿是同步的（解析 + 一次原子小文件写），在广播前完成并随事件直推，
 * 前端不再需要"done 之后轮询拉取"的窗口机制。
 *
 * **为什么注入依赖而不直接持有 `RunManager`**：本模块只依赖"落盘口 + 记账口 + 卡片定稿口"，
 * 与并发编排（配额、活跃表、drain）无关；注入后本模块可独立单测，`run-manager.ts` 只留编排。
 */
import type { Logger } from 'pino';
import type { HistoryMessage, RunRuntime, UsageInfo, UsageStore } from '../types.js';
import type { HistoryStore } from './history.js';
import { genMessageId, toSeconds } from './message-format.js';
import type { NextActionsFinalizeInput, NextActionsStore, NextActionsView } from './next-actions.js';
import type { RunImpl } from './run-impl.js';
import type { ToolEventStore } from './tool-events.js';

/** 一轮收尾所需的最小上下文（由调用方从 run 与本轮请求装配） */
export interface FinalizeTurn {
  userId: string;
  threadId: string;
  /** 本轮运行期回填（工具清单由 `agent-factory` 写入；轮末才读，见 007 T006） */
  runtime: RunRuntime;
  /**
   * 本轮卡片条数上限（SOUL 配置，与提示词装配同源）。
   * `undefined` = 该数字人未开启下一步动作提示 → 收尾时跳过卡片定稿。
   */
  nextActionsMax?: number;
}

export interface RunFinalizeDeps {
  history: HistoryStore;
  usage: UsageStore;
  logger?: Logger;
  /** 工具调用记录：轮末 `flush`，保证 done 到达时工具卡片已可读 */
  toolEvents?: ToolEventStore;
  /** 滚动摘要（FR-018） */
  summary?: { trigger(userId: string, threadId: string): Promise<void> };
  /** 007 修订：卡片定稿口（缺省 = 该侧未装配，功能整体不生效） */
  nextActions?: Pick<NextActionsStore, 'finalize'>;
  now: () => number;
}

export class RunFinalizer {
  constructor(private readonly deps: RunFinalizeDeps) {}

  /**
   * 成功轮收尾：落盘 → 广播 done → 触发两个后台任务。
   *
   * assistant 消息 id 用 run 启动时**预生成**的那个（工具事件行已按它归属），
   * 不能在这里另生成——否则工具卡片会挂到一条不存在的消息上。
   */
  async done(
    run: RunImpl,
    turn: FinalizeTurn,
    userMessage: HistoryMessage,
    usage: UsageInfo,
  ): Promise<void> {
    run.state = 'done';
    const nowMs = this.deps.now();
    const ts = new Date(nowMs).toISOString();
    const durationMs = nowMs - run.startedAt;
    const userMessageId = genMessageId(nowMs);
    const assistantId = run.assistantMessageId;
    this.recordUsage(turn, run.agentName, usage);
    // 007 修订（Tail Protocol）：卡片随 done 直推，定稿（解析 + 写快照）必须在广播前完成。
    // `run.buffer` 此刻已被 consume 剥离尾部块（用户所见 = 落盘正文），历史 jsonl 永不含卡片内容。
    const nextActions = this.finalizeNextActions(run, turn, assistantId);
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
      this.deps.history.append(turn.userId, turn.threadId, {
        ...userMessage,
        id: userMessageId,
        ts,
        agent_name: run.agentName,
      }),
      this.deps.history.append(turn.userId, turn.threadId, assistantMessage),
      // 工具记录同样"先落盘后广播"：否则 done 到达时前端立即刷新会读不到工具卡片
      this.deps.toolEvents?.flush(turn.userId, turn.threadId) ?? Promise.resolve(),
    ]);
    run.emit({
      type: 'done',
      data: {
        finish_reason: 'completed',
        usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
        duration_seconds: toSeconds(durationMs),
        message_id: assistantId,
        agent_name: run.agentName,
        ...(nextActions ? { next_actions: nextActions } : {}),
      },
    });
    // FR-018：窗口外攒满一批则 fire-and-forget 增量重写摘要
    void this.deps.summary?.trigger(turn.userId, turn.threadId);
  }

  /** LLM 错误（非中断）：失败轮落盘（status='failed' + 错误信息 + 已消耗 usage/耗时） */
  async error(
    run: RunImpl,
    turn: FinalizeTurn,
    userMessage: HistoryMessage,
    ev: { code: string; message: string; usage?: UsageInfo },
  ): Promise<void> {
    run.state = 'error';
    const nowMs = this.deps.now();
    const ts = new Date(nowMs).toISOString();
    const durationMs = nowMs - run.startedAt;
    if (ev.usage) this.recordUsage(turn, run.agentName, ev.usage);
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
      this.deps.history.append(turn.userId, turn.threadId, {
        ...userMessage,
        id: genMessageId(nowMs),
        ts,
        agent_name: run.agentName,
      }),
      this.deps.history.append(turn.userId, turn.threadId, assistantMessage),
      // 失败轮同样等工具记录落盘（工具可能已成功执行过，卡片不该丢）
      this.deps.toolEvents?.flush(turn.userId, turn.threadId) ?? Promise.resolve(),
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

  aborted(run: RunImpl, turn: FinalizeTurn, usage?: UsageInfo): void {
    run.state = 'aborted';
    const u = usage ?? { inputTokens: 0, outputTokens: 0 };
    run.emit({
      type: 'done',
      data: {
        finish_reason: 'stop',
        usage: { input_tokens: u.inputTokens, output_tokens: u.outputTokens },
        duration_seconds: toSeconds(this.deps.now() - run.startedAt),
        message_id: null, // 本轮丢弃，无落盘消息
        agent_name: run.agentName,
      },
    });
    // FR-027：丢弃本轮消息，但已消耗 token 照记
    this.recordUsage(turn, run.agentName, u);
  }

  /** 用量记在**本轮实际使用的数字人**名下（会话不绑定数字人，用谁记谁） */
  private recordUsage(turn: FinalizeTurn, agentName: string, u: UsageInfo): void {
    this.deps.usage.record({
      userId: turn.userId,
      threadId: turn.threadId,
      agentName,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      createdAt: new Date(this.deps.now()).toISOString(),
    });
  }

  /**
   * 007 修订（Tail Protocol）：卡片定稿（同步，永不抛错）。
   *
   * 素材取自**本轮真相**：尾部块原文是 consume 从回答流捕获的 `run.nextActionsTail`，
   * 工具清单读 `turn.runtime.availableTools`（装配方在跑完后才回填，故此处现读）；
   * 条数上限与提示词装配同源（`turn.nextActionsMax`，未开启即跳过）。
   * `finalize` 失败只告警并返回 `undefined`——本轮无卡片，绝不影响落盘与广播。
   */
  private finalizeNextActions(
    run: RunImpl,
    turn: FinalizeTurn,
    assistantMessageId: string,
  ): NextActionsView | undefined {
    const store = this.deps.nextActions;
    if (!store || turn.nextActionsMax === undefined) return undefined;
    const input: NextActionsFinalizeInput = {
      userId: turn.userId,
      threadId: turn.threadId,
      messageId: assistantMessageId,
      agentName: run.agentName,
      tailText: run.nextActionsTail,
      availableTools: [...turn.runtime.availableTools],
      max: turn.nextActionsMax,
    };
    run.nextActionsTail = '';
    return store.finalize(input);
  }
}
