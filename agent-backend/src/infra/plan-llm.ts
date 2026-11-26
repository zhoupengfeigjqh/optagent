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

export async function callPlanWithTimeout(
  plan: PlanLlm,
  request: { system: string; messages: Parameters<PlanLlm>[0]['messages'] },
  signal: AbortSignal,
  /** 028：单次规划超时；缺省取常量，生产由 `config.yaml` 的 `plan.timeout_ms` 注入 */
  timeoutMs: number = PLAN_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', abort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new PlanCallTimeoutError(timeoutMs));
    }, timeoutMs);
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
