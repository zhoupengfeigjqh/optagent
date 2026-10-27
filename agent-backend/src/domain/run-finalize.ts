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
import type {
  NextActionsFinalizeInput,
  NextActionsStore,
  NextActionsView,
} from './next-actions.js';
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
  /** 滚动摘要（FR-018）；009：落点按（用户，数字人，会话）解析 */
  summary?: { trigger(userId: string, agentName: string, threadId: string): Promise<void> };
  /** 007 修订：卡片定稿口（缺省 = 该侧未装配，功能整体不生效） */
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

/** 失败日志里上游原文的截断长度（够定位问题，又不至于把一行日志撑成一篇报文） */
const LLM_FAILURE_LOG_TEXT_MAX = 500;

export class RunFinalizer {
  constructor(private readonly deps: RunFinalizeDeps) {}

  /**
   * 成功轮收尾：落盘 → 广播 done → 触发两个后台任务。
   *
   * assistant 消息 id 用 run 启动时**预生成**的那个（工具事件行已按它归属），
   * 不能在这里另生成——否则工具卡片会挂到一条不存在的消息上。
   *
   * @returns `false` = 落盘失败（已广播 `HISTORY_WRITE_FAILED`，**未**广播 done）。
   * 调用方据此把本轮记为失败，避免"日志说成功、用户看到错误"。
   */
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
    // FR-018：窗口外攒满一批则 fire-and-forget 增量重写摘要
    void this.deps.summary?.trigger(turn.userId, run.agentName, turn.threadId);
    return true;
  }

  /** LLM 错误（非中断）：失败轮落盘（status='failed' + 错误信息 + 已消耗 usage/耗时） */
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
    // 同一份诊断：失败行与 SSE error 事件共用同一个对象（§19.5 不变式 5）
    const error = toHistoryErrorInfo(ev);
    // 原则九：原始错误落结构化日志（上游状态码 / 请求 id / 截断原文 + 关联线索）
    this.logLlmFailure(run, turn, error, durationMs);
    // FR-011：失败轮留痕（assistant 行 content 为空，错误信息在 error 字段）
    const assistantMessage: HistoryMessage = {
      id: genMessageId(nowMs),
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
    // 只记结构化日志并继续把上游错误告诉用户。
    await this.persist(run, turn, false, () =>
      Promise.all([
        this.deps.history.append(turn.userId, run.agentName, turn.threadId, {
          ...userMessage,
          id: genMessageId(nowMs),
          ts,
          agent_name: run.agentName,
        }),
        this.deps.history.append(turn.userId, run.agentName, turn.threadId, assistantMessage),
        // 失败轮同样等工具记录落盘（工具可能已成功执行过，卡片不该丢）
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
        message_id: null, // 本轮丢弃，无落盘消息
        agent_name: run.agentName,
      },
    });
    // FR-027：丢弃本轮消息，但已消耗 token 照记
    this.recordUsage(turn, run.agentName, u);
  }

  /**
   * 统一落盘口（2026-10-27 新增）：把"写盘失败"与"实例崩溃"彻底分开。
   *
   * 为什么不能直接冒泡：`consumeTurn` 的 catch 把任何未知异常都当成实例崩溃
   * （销毁池内实例 + 广播 `INTERNAL_ERROR`），而磁盘满 / 权限不足 / 文件被占用
   * 与 Agent 实例状态毫无关系——一次落盘失败不该让下一句重建全部 MCP 连接，
   * 也不该把"已经生成的回答"替换成一个笼统的内部错误。
   *
   * @param notify `true` = 需要主动告知用户（成功轮没有别的错误事件可复用）；
   *   `false` = 已有主因错误，只记日志（保证一轮仍然**恰好一个** error 事件）。
   */
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

  /**
   * 原则九：LLM 失败 MUST 落结构化日志（含上游状态码 / 请求 id / 截断原文 + 关联线索）。
   *
   * 只告警**需要人工介入**的两类（余额不足 / 凭证无效）——把"用户稍后重试就好"的 5xx
   * 也标成 `alert` 会让告警失去意义。未装配 logger 时静默跳过（日志不致命）。
   */
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
