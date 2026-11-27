import type { Logger } from 'pino';
import type {
  HistoryErrorInfo,
  HistoryMessage,
  RunRuntime,
  UsageInfo,
  UsageStore,
} from '../types.js';
import { isAlertLlmFailure, toHistoryErrorInfo } from './llm-error.js';
import type { HistoryStore } from './history.js';
import { genMessageId, toSeconds } from './message-format.js';
import { effectiveNextActionsMax } from './next-actions.js';
import type {
  NextActionsFinalizeInput,
  NextActionsStore,
  NextActionsView,
} from './next-actions.js';
import type { FocusToolTip } from './intent-focus/types.js';
import type { RunImpl } from './run-impl.js';
import type { ToolEventStore } from './tool-events.js';

export interface FinalizeTurn {
  userId: string;
  threadId: string;
  runtime: RunRuntime;
  /**
   * 本轮卡片条数上限（SOUL 配置，与提示词装配同源）。
   * `undefined` = 该数字人未开启下一步动作提示 → 收尾时跳过卡片定稿。
   */
  nextActionsMax?: number;
  focusToolTips?: readonly FocusToolTip[];
}

export interface RunFinalizeDeps {
  history: HistoryStore;
  usage: UsageStore;
  logger?: Logger;
  toolEvents?: ToolEventStore;
  summary?: { trigger(userId: string, agentName: string, threadId: string): Promise<void> };
  nextActions?: Pick<NextActionsStore, 'finalize'>;
  /**
   * 2026-10-15：LLM 身份取值口（`provider` / 默认 `model`），由装配处注入。
   *
   * 为什么不在 `domain` 里直接读 `config`：分层约束（`domain` 不反向依赖 `config`）；
   * 注入后本模块仍可独立单测（缺省即不记这两个字段，日志只是少两列，不影响收尾）。
   */
  llmInfo?: () => { provider: string; model: string };
  now: () => number;
}

const LLM_FAILURE_LOG_TEXT_MAX = 500;

export class RunFinalizer {
  constructor(private readonly deps: RunFinalizeDeps) {}

  async done(
    run: RunImpl,
    turn: FinalizeTurn,
    userMessage: HistoryMessage,
    usage: UsageInfo,
  ): Promise<boolean> {
    run.state = 'done';
    const nowMs = this.deps.now();
    const ts = new Date(nowMs).toISOString();
    const durationMs = nowMs - run.startedAt;
    const userMessageId = genMessageId(nowMs);
    const assistantId = run.assistantMessageId;
    this.recordUsage(turn, run.agentName, usage);
    // 007 修订（Tail Protocol）：卡片随 done 直推，定稿（解析 + 写快照）必须在广播前完成。
    const nextActions = this.finalizeNextActions(run, turn, assistantId);
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
    const persisted = await this.persist(run, turn, true, () =>
      Promise.all([
        this.deps.history.append(turn.userId, run.agentName, turn.threadId, {
          ...userMessage,
          id: userMessageId,
          ts,
          agent_name: run.agentName,
        }),
        this.deps.history.append(turn.userId, run.agentName, turn.threadId, assistantMessage),
        // 工具记录同样"先落盘后广播"：否则 done 到达时前端立即刷新会读不到工具卡片
        this.deps.toolEvents?.flush(turn.userId, run.agentName, turn.threadId) ?? Promise.resolve(),
      ]),
    );
    if (!persisted) return false;
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
    void this.deps.summary?.trigger(turn.userId, run.agentName, turn.threadId);
    return true;
  }

  async error(
    run: RunImpl,
    turn: FinalizeTurn,
    userMessage: HistoryMessage,
    ev: HistoryErrorInfo & { usage?: UsageInfo },
  ): Promise<void> {
    run.state = 'error';
    const nowMs = this.deps.now();
    const ts = new Date(nowMs).toISOString();
    const durationMs = nowMs - run.startedAt;
    if (ev.usage) this.recordUsage(turn, run.agentName, ev.usage);
    const error = toHistoryErrorInfo(ev);
    this.logLlmFailure(run, turn, error, durationMs);
    const assistantId = run.assistantMessageId || genMessageId(nowMs)
    const assistantMessage: HistoryMessage = {
      id: assistantId,
      role: 'assistant',
      content: run.buffer,
      ts,
      status: 'failed',
      duration_ms: durationMs,
      error,
      agent_name: run.agentName,
    };
    if (ev.usage) {
      assistantMessage.usage = {
        input_tokens: ev.usage.inputTokens,
        output_tokens: ev.usage.outputTokens,
      };
    }
    // 落盘失败不得覆盖"LLM 失败"这个主因：`notify=false`（本轮只允许一个 error 事件），
    await this.persist(run, turn, false, () =>
      Promise.all([
        this.deps.history.append(turn.userId, run.agentName, turn.threadId, {
          ...userMessage,
          id: genMessageId(nowMs),
          ts,
          agent_name: run.agentName,
        }),
        this.deps.history.append(turn.userId, run.agentName, turn.threadId, assistantMessage),
        this.deps.toolEvents?.flush(turn.userId, run.agentName, turn.threadId) ?? Promise.resolve(),
      ]),
    );
    run.emit({
      type: 'error',
      data: {
        error,
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
        message_id: null,
        agent_name: run.agentName,
      },
    });
    this.recordUsage(turn, run.agentName, u);
  }

  private async persist(
    run: RunImpl,
    turn: FinalizeTurn,
    notify: boolean,
    write: () => Promise<unknown>,
  ): Promise<boolean> {
    try {
      await write();
      return true;
    } catch (err) {
      // `done()` 已把状态置为 'done'；落盘失败后改记为 'error'（终态必须与事实一致）
      run.state = 'error';
      this.deps.logger?.error(
        {
          err,
          alert: true,
          event: 'run.persist.failed',
          scope: 'run',
          user_id: turn.userId,
          thread_id: turn.threadId,
          agent_name: run.agentName,
        },
        '本轮落盘失败（磁盘/权限类），会话数据可能缺失',
      );
      if (notify) {
        run.emit({
          type: 'error',
          data: {
            error: { code: 'HISTORY_WRITE_FAILED', message: '本轮内容未能保存，请重试' },
            duration_seconds: toSeconds(this.deps.now() - run.startedAt),
            agent_name: run.agentName,
          },
        });
      }
      return false;
    }
  }

  /** 用量记在**本轮实际使用的数字人**名下（009 下恒等于会话归属：会话归属不可变更） */
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

  private logLlmFailure(
    run: RunImpl,
    turn: FinalizeTurn,
    error: HistoryErrorInfo,
    durationMs: number,
  ): void {
    const logger = this.deps.logger;
    if (!logger) return;
    const llm = this.deps.llmInfo?.();
    // 请求级模型覆盖优先（`run.modelId`），否则记默认模型——日志要说清"是哪个模型失败的"
    const model = run.modelId ?? llm?.model;
    logger.warn(
      {
        event: 'llm.call.failed',
        scope: 'run',
        user_id: turn.userId,
        thread_id: turn.threadId,
        agent_name: run.agentName,
        code: error.code,
        ...(error.upstream_status !== undefined ? { upstream_status: error.upstream_status } : {}),
        ...(error.upstream_type !== undefined ? { upstream_type: error.upstream_type } : {}),
        ...(error.request_id !== undefined ? { request_id: error.request_id } : {}),
        ...(llm?.provider !== undefined ? { provider: llm.provider } : {}),
        ...(model !== undefined ? { model } : {}),
        message: error.message.slice(0, LLM_FAILURE_LOG_TEXT_MAX),
        duration_ms: durationMs,
        ...(isAlertLlmFailure(error.code) ? { alert: true } : {}),
      },
      `LLM 调用失败：${error.code}${error.upstream_status !== undefined ? `（上游 ${error.upstream_status}）` : ''}`,
    );
  }

  private finalizeNextActions(
    run: RunImpl,
    turn: FinalizeTurn,
    assistantMessageId: string,
  ): NextActionsView | undefined {
    const store = this.deps.nextActions;
    const focusToolTips = turn.focusToolTips ?? [];
    // 避免两处漂移成"提示词要求产卡片、收尾却静默丢弃"
    const max = effectiveNextActionsMax(turn.nextActionsMax, focusToolTips);
    if (!store || max === undefined) return undefined;
    const input: NextActionsFinalizeInput = {
      userId: turn.userId,
      threadId: turn.threadId,
      messageId: assistantMessageId,
      agentName: run.agentName,
      tailText: run.nextActionsTail,
      focusToolTips,
      max,
    };
    run.nextActionsTail = '';
    return store.finalize(input);
  }
}
