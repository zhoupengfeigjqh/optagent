/**
 * 分批判定（016）。
 *
 * 从 runner 拆出（单文件 ≤500 行）：这里只有"串行跑批、合并分数、归因失败"，
 * 不含任何业务选择逻辑，便于单独覆盖超时分配与部分降级。
 *
 * 串行而非并行：判定服务是单实例 CPU，并发只会在其内部排队，墙钟时间并不减少，
 * 反而让超时归因变模糊。单批超时按"剩余预算 ÷ 剩余批数"动态分配，保证整体有界。
 */
import type { LayaDecideResult, SystemOneQuestion } from '../../infra/laya-client.js';
import type { QuestionMap } from './types.js';

/** 单批超时的下限（毫秒）：更低会把正常的前向计算误伤成超时 */
export const MIN_BATCH_TIMEOUT_MS = 300;

/** 判定客户端（`LayaClient` 的结构子集，便于测试注入） */
export interface DecideClient {
  decide(
    state: string,
    questions: Record<string, SystemOneQuestion>,
    timeoutMs?: number,
  ): Promise<LayaDecideResult>;
}

export interface BatchDeciderLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface BatchDeciderDeps {
  client: DecideClient;
  logger?: BatchDeciderLogger;
  now?: () => number;
}

export interface DecideOutcome {
  scores: Record<string, number>;
  failures: string[];
  /** 全批失败时的根因（`timeout` / `http_422` / `all_batches_failed`） */
  failureReason: string | null;
}

export class BatchDecider {
  private readonly now: () => number;

  constructor(private readonly deps: BatchDeciderDeps) {
    this.now = deps.now ?? Date.now;
  }

  async decideAll(
    state: string,
    batches: readonly QuestionMap[],
    deadline: number,
    stage: 'skill' | 'capability',
  ): Promise<DecideOutcome> {
    const scores: Record<string, number> = {};
    const failures: string[] = [];
    const reasons = new Set<string>();
    let failureReason: string | null = null;

    for (const [index, batch] of batches.entries()) {
      const remainingBatches = batches.length - index;
      const remaining = deadline - this.now();
      const perBatch = Math.max(
        MIN_BATCH_TIMEOUT_MS,
        Math.floor(Math.max(remaining, MIN_BATCH_TIMEOUT_MS) / remainingBatches) - 100,
      );
      const batchStarted = this.now();
      const result = await this.deps.client.decide(state, batch, perBatch).catch(
        (err: unknown): LayaDecideResult => ({
          ok: false,
          reason: 'network',
          message: (err as Error)?.message ?? String(err),
        }),
      );
      const ms = this.now() - batchStarted;

      if (!result.ok) {
        failures.push(`batch_${index}:${result.reason}${result.status ? `:${result.status}` : ''}`);
        reasons.add(`${result.reason}${result.status !== undefined ? `_${result.status}` : ''}`);
        this.deps.logger?.warn(
          {
            event: 'intent-focus.degraded',
            alert: true,
            stage,
            reason: result.reason,
            ...(result.status !== undefined ? { status: result.status } : {}),
            batch_index: index,
            batch_size: Object.keys(batch).length,
            detail: result.message,
            ms,
          },
          `意图聚焦（${stage}）第 ${index + 1} 批判定失败：${result.message}`,
        );
        continue;
      }

      Object.assign(scores, result.scores);
    }

    if (failures.length === batches.length && batches.length > 0) {
      failureReason = reasons.size === 1 ? [...reasons][0]! : 'all_batches_failed';
    }
    return { scores, failures, failureReason };
  }
}
