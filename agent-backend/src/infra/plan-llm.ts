/**
 * 规划调用适配（028 FR-004）：把 `LlmProvider.streamChat` 的流式事件
 * 聚合成一次**非流式**文本结果。
 *
 * 三条口径（data-model §1）：
 * - `tools: []`：规划只输出 JSON，不给工具；
 * - `thinking: false`：计划是短结构化输出，思考只会拖长首字延迟；
 * - 不向上暴露增量：规划结果对用户不可见，无需 SSE。
 */
import { PLAN_TIMEOUT_MS } from '../domain/plan/types.js';
import type { PlanLlm } from './plan-orchestrator.js';
import type { LlmProvider } from './llm/llm-provider.js';

/**
 * 规划调用超时（2026-11-26）。
 *
 * 单独成类而不是普通 `Error`：编排器据此判定"**不重试**"——超时重试只会让首字延迟翻倍。
 */
export class PlanCallTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`规划调用超过 ${timeoutMs}ms 未返回`);
    this.name = 'PlanCallTimeoutError';
  }
}

/**
 * 带硬超时的规划调用（FR-005）。
 *
 * 超时与用户停止都走同一个 `AbortController`：前者抛 `PlanCallTimeoutError`（调用方不重试），
 * 后者由调用方按 `signal.aborted` 区分。
 *
 * **为什么还要 `Promise.race`**：`abort()` 只是"发信号"，是否真的结束取决于 provider 是否
 * 响应 signal。只 abort 不竞速时，一个不响应 abort 的 provider 会让本轮永远卡在规划阶段
 * （`for await` 拿不到下一个事件 → `finally` 不执行 → 该会话一直 409）。竞速保证本函数
 * 无论 provider 行为如何都会在 `PLAN_TIMEOUT_MS` 后返回。
 */
export async function callPlanWithTimeout(
  plan: PlanLlm,
  request: { system: string; messages: Parameters<PlanLlm>[0]['messages'] },
  signal: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', abort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new PlanCallTimeoutError(PLAN_TIMEOUT_MS));
    }, PLAN_TIMEOUT_MS);
  });
  try {
    return await Promise.race([plan({ ...request, signal: controller.signal }), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export function createPlanLlm(llm: LlmProvider): PlanLlm {
  return async ({ system, messages, signal }) => {
    const parts: string[] = [];
    for await (const event of llm.streamChat({
      systemPrompt: system,
      messages: [...messages],
      tools: [],
      thinking: false,
      signal,
    })) {
      if (event.type === 'content_delta') parts.push(event.delta);
      else if (event.type === 'error') throw new Error(event.message);
    }
    return parts.join('');
  };
}
