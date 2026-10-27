/**
 * 意图聚焦（013）编排：开关 → 跳过 → 配置 → 候选 → 分批判定 → 筛选 → 留档 → 返回提示。
 *
 * 为什么单独成模块（而不是写进 `consumeTurn`）：
 * - 它依赖**本轮真实可用工具清单**，而清单只有在 `agent-factory` 装配完工具后才可得；
 *   故以"判定口"（`IntentFocusPort`）的形式注入，由装配方在装配后、模型调用前回调；
 * - 编排逻辑（五类处置、分批、留档字段、降级）需要独立单测，不宜绑在流消费的大函数里。
 *
 * 所有失败都**降级为"本轮无聚焦提示"**，绝不抛错（规格 FR-009/FR-052）。
 * 分批时采用**部分降级**：某批失败只丢那批候选，其余批的结果照常参与筛选。
 */
import type { IntentFocusConfig } from '../config.js';
import type { LayaDecideResult } from '../infra/laya-client.js';
import {
  buildQuestionBatches,
  decideDisposition,
  prepareState,
  selectActions,
  selectCandidates,
  type QuestionBatch,
  type ToolCandidate,
} from './intent-focus.js';
import type { IntentFocusRecordDraft } from './intent-focus-store.js';

/** 单批超时的下限（毫秒）：更低会把正常的前向计算误伤成超时 */
const MIN_BATCH_TIMEOUT_MS = 300;

/** 一次判定的上下文（由 `consumeTurn` 提供） */
export interface IntentFocusInput {
  userId: string;
  agentName: string;
  threadId: string;
  /** 本轮 assistant 消息 id（与历史对账用；可能为空） */
  messageId: string | null;
  /** 本轮用户输入原文 */
  userInput: string;
  /** 预置动作入口（下一步动作卡片 / 首屏问题实例卡片）→ 跳过判定 */
  skip: boolean;
  /** 本轮模型真实可用工具（装配期回填；`label` 为内置工具的中文名） */
  tools: ReadonlyArray<{ name: string; description: string; label?: string }>;
}

/** 域层对意图聚焦的唯一依赖口 */
export interface IntentFocusPort {
  /** 返回要追加到本轮 `systemExtra` 的提示；空串 = 不追加 */
  judge(input: IntentFocusInput): Promise<string>;
}

/** 判定客户端（`LayaClient` 的结构子集，便于测试注入） */
export interface IntentFocusClient {
  decide(
    state: string,
    questions: QuestionBatch['questions'],
    timeoutMs?: number,
  ): Promise<LayaDecideResult>;
}

/** 留档存储（`IntentFocusStore` 的结构子集） */
export interface IntentFocusRecorder {
  append(
    userId: string,
    agentName: string,
    threadId: string,
    draft: IntentFocusRecordDraft,
  ): Promise<void>;
}

export interface IntentFocusRunnerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface IntentFocusRunnerDeps {
  /** 缺省 = 判定模型未配置（功能不可用，fail-closed） */
  config?: IntentFocusConfig;
  /** 缺省 = 未装配 → 视为不可用 */
  client?: IntentFocusClient;
  /** 缺省 = 未装配 → 不落记录 */
  store?: IntentFocusRecorder;
  /** SOUL 开关（逐次现读，fail-closed） */
  isEnabled: (userId: string, agentName: string) => boolean;
  logger?: IntentFocusRunnerLogger;
  now?: () => number;
}

export class IntentFocusRunner implements IntentFocusPort {
  private readonly now: () => number;

  constructor(private readonly deps: IntentFocusRunnerDeps) {
    this.now = deps.now ?? Date.now;
  }

  async judge(input: IntentFocusInput): Promise<string> {
    // 开关关闭：零副作用（不判定、不落档，规格 FR-032）
    if (!this.deps.isEnabled(input.userId, input.agentName)) return '';

    const prepared = prepareState(input.userInput);
    const { candidates, truncated } = selectCandidates(normalizeTools(input.tools));
    const batches = buildQuestionBatches(candidates);
    const startedAt = this.now();
    const base = {
      thread_id: input.threadId,
      agent_name: input.agentName,
      message_id: input.messageId,
      input: prepared.state,
      input_truncated: prepared.truncated,
      candidates: candidates.length,
      batches: batches.length,
      truncated,
    };

    // 预置动作入口：跳过（优先于"未配置"，因为这是确定的业务行为而非故障）
    if (input.skip) {
      await this.record(input, {
        ...base,
        disposition: 'skipped',
        reason: 'skip:preset_action',
        model: null,
        round_ms: null,
        probabilities: null,
        actions: [],
        focus_prompt: '',
        error: null,
      });
      return '';
    }

    const config = this.deps.config;
    const client = this.deps.client;
    if (!config || !client) {
      await this.record(input, {
        ...base,
        disposition: 'unconfigured',
        reason: 'no_config',
        model: null,
        round_ms: null,
        probabilities: null,
        actions: [],
        focus_prompt: '',
        error: null,
      });
      this.deps.logger?.warn(
        {
          event: 'intent-focus.unconfigured',
          thread_id: input.threadId,
          agent_name: input.agentName,
        },
        '意图聚焦已开启但判定模型未配置，本轮按不聚焦处理',
      );
      return '';
    }

    // 无可用工具：不发起调用（题量为 0 时调用没有意义）
    if (candidates.length === 0) {
      await this.record(input, {
        ...base,
        disposition: 'empty',
        reason: 'no_tools',
        model: config.model,
        round_ms: 0,
        probabilities: null,
        actions: [],
        focus_prompt: '',
        error: null,
      });
      return '';
    }

    const decided = await this.decideAll(client, prepared.state, batches, config.timeoutMs);
    const roundMs = this.now() - startedAt;

    if (Object.keys(decided.scores).length === 0) {
      const detail = decided.failures.join('; ') || 'no_scores';
      // 根因优先（`timeout` / `http_503`），多因归一时退回 `all_batches_failed`（data-model §6.1）
      const reason = decided.failureReason ?? 'all_batches_failed';
      await this.record(input, {
        ...base,
        disposition: 'degraded',
        reason,
        model: config.model,
        round_ms: roundMs,
        probabilities: null,
        actions: [],
        focus_prompt: '',
        error: detail,
      });
      this.deps.logger?.warn(
        {
          event: 'intent-focus.failed',
          alert: true,
          reason,
          // 原始错误文案（含服务端响应体摘要）：只记状态码无法定位 422 这类 schema 拒绝
          detail,
          thread_id: input.threadId,
          agent_name: input.agentName,
          batches: batches.length,
          round_ms: roundMs,
        },
        `意图聚焦判定失败，本轮按不聚焦处理：${detail}`,
      );
      return '';
    }

    const selection = selectActions({
      candidates,
      scores: decided.scores,
      threshold: config.threshold,
    });
    const disposition = decideDisposition({
      kind: 'ok',
      candidates: candidates.length,
      selected: selection.actions.length,
    });

    await this.record(input, {
      ...base,
      disposition: disposition.disposition,
      reason: disposition.reason,
      model: config.model,
      round_ms: roundMs,
      probabilities: selection.scores,
      actions: selection.actions.map((a) => a.tools[0]!).filter(Boolean),
      focus_prompt: selection.focusPrompt,
      error: decided.failures.length > 0 ? decided.failures.join('; ') : null,
    });

    if (decided.failures.length > 0) {
      this.deps.logger?.warn(
        {
          event: 'intent-focus.partial',
          alert: true,
          thread_id: input.threadId,
          agent_name: input.agentName,
          batches: batches.length,
          failed: decided.failures.length,
          detail: decided.failures.join('; '),
          round_ms: roundMs,
        },
        `意图聚焦部分批次失败，已用剩余 ${Object.keys(decided.scores).length} 个工具的结果继续`,
      );
    }

    this.deps.logger?.info(
      {
        event: selection.focusPrompt === '' ? 'intent-focus.empty' : 'intent-focus.ok',
        thread_id: input.threadId,
        agent_name: input.agentName,
        candidates: candidates.length,
        batches: batches.length,
        actions: selection.actions.length,
        round_ms: roundMs,
        threshold: config.threshold,
      },
      selection.focusPrompt === ''
        ? '意图聚焦：本轮无需聚焦'
        : `意图聚焦：本轮聚焦 ${selection.actions.length} 个工具`,
    );

    return selection.focusPrompt;
  }

  /**
   * 逐批串行判定并合并分数。
   *
   * 串行而非并行：判定服务是单实例 CPU，并发只会在其内部排队，墙钟时间并不减少，
   * 反而让超时归因变模糊。单批超时按"总预算 ÷ 批数"分配，保证整体有界。
   */
  private async decideAll(
    client: IntentFocusClient,
    state: string,
    batches: readonly QuestionBatch[],
    totalTimeoutMs: number,
  ): Promise<{ scores: Record<string, number>; failures: string[]; failureReason: string | null }> {
    const perBatch = Math.max(
      MIN_BATCH_TIMEOUT_MS,
      Math.floor(totalTimeoutMs / Math.max(batches.length, 1)) - 100,
    );
    const scores: Record<string, number> = {};
    const failures: string[] = [];
    /** 各批失败的根因去重（如 `timeout` / `http_422`）；只有全批失败时才有意义 */
    const reasons = new Set<string>();
    let failureReason: string | null = null;

    for (const [index, batch] of batches.entries()) {
      const batchStarted = this.now();
      const result = await client.decide(state, batch.questions, perBatch).catch(
        (err: unknown): LayaDecideResult => ({
          ok: false,
          reason: 'network',
          message: (err as Error)?.message ?? String(err),
        }),
      );
      const ms = this.now() - batchStarted;

      if (!result.ok) {
        failures.push(`batch_${index}:${result.reason}${result.status ? `:${result.status}` : ''}`);
        // 根因口径与 data-model 一致：无状态码用 `timeout`/`network`，有状态码用 `http_503`
        reasons.add(`${result.reason}${result.status !== undefined ? `_${result.status}` : ''}`);
        this.deps.logger?.warn(
          {
            event: 'intent-focus.batch.failed',
            alert: true,
            batch_index: index,
            batch_size: batch.candidates.length,
            reason: result.reason,
            ...(result.status !== undefined ? { status: result.status } : {}),
            detail: result.message,
            ms,
          },
          `意图聚焦第 ${index + 1} 批判定失败：${result.message}`,
        );
        continue;
      }

      Object.assign(scores, result.scores);
      this.deps.logger?.info(
        {
          event: 'intent-focus.batch.ok',
          batch_index: index,
          batch_size: batch.candidates.length,
          ms,
        },
        `意图聚焦第 ${index + 1} 批判定完成`,
      );
    }

    // 全批失败才算"没有可用分数"；去重后只剩一个根因就用它（`timeout` / `http_422`），
    // 多个根因无法归一时退回笼统的 `all_batches_failed`，避免记下似是而非的单一原因
    if (failures.length === batches.length && batches.length > 0) {
      failureReason = reasons.size === 1 ? [...reasons][0]! : 'all_batches_failed';
    }

    return { scores, failures, failureReason };
  }

  private async record(input: IntentFocusInput, draft: IntentFocusRecordDraft): Promise<void> {
    const store = this.deps.store;
    if (!store) return;
    try {
      await store.append(input.userId, input.agentName, input.threadId, draft);
    } catch (err) {
      // store 内部已兜底；这里是第二道防线（记录失败绝不影响对话）
      this.deps.logger?.warn(
        {
          event: 'intent-focus.record.failed',
          alert: true,
          thread_id: input.threadId,
          agent_name: input.agentName,
        },
        `意图聚焦记录写入失败：${(err as Error).message}`,
      );
    }
  }
}

/** 工具清单去空名、去重复（MCP 与内置可能同名：保留首个，避免同一工具两条命题） */
function normalizeTools(
  tools: ReadonlyArray<{ name: string; description: string; label?: string }>,
): ToolCandidate[] {
  const seen = new Set<string>();
  const result: ToolCandidate[] = [];
  for (const tool of tools) {
    if (tool.name.length === 0 || seen.has(tool.name)) continue;
    seen.add(tool.name);
    result.push({
      name: tool.name,
      description: tool.description,
      ...(tool.label !== undefined ? { label: tool.label } : {}),
    });
  }
  return result;
}
