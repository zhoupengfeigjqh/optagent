import type { ModelSelection } from '../types.js';
import type { RewriteLlm, RewriteLlmRequest } from '../domain/intent-focus/rewrite.js';
import type { LlmProvider } from './llm/llm-provider.js';

/** 改写失败原因（供降级日志与记录使用；不向用户展示） */
export type RewriteLlmFailure = 'llm_failed' | 'timeout' | 'aborted';

/** 改写调用失败（调用方按 `reason` 归类，**一律降级**，不上抛到对话主链路） */
export class RewriteLlmError extends Error {
  constructor(
    readonly reason: RewriteLlmFailure,
    message: string,
  ) {
    super(message);
    this.name = 'RewriteLlmError';
  }
}

export interface RewriteLlmDeps {
  llm: () => LlmProvider;
  /**
   * 请求级模型覆盖的 provider 构造。
   *
   * 缺省时**不允许**传 `model`：静默回落到默认模型会让"本轮选的是 A 模型，
   * 改写却用 B 模型"变成不可见的行为差异（契约 §6「不降级到其它模型」）。
   */
  providerFor?: (entry: ModelSelection) => LlmProvider;
}

export function createRewriteLlm(deps: RewriteLlmDeps): RewriteLlm {
  return {
    async complete(req: RewriteLlmRequest): Promise<string> {
      const provider = selectProvider(deps, req);

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, Math.max(1, req.timeoutMs));
      const onAbort = () => controller.abort();
      const external = req.signal;
      if (external) {
        if (external.aborted) controller.abort();
        else external.addEventListener('abort', onAbort, { once: true });
      }

      let text = '';
      try {
        for await (const event of provider.streamChat({
          systemPrompt: req.systemPrompt,
          messages: req.messages,
          tools: [],
          thinking: false,
          signal: controller.signal,
        })) {
          if (event.type === 'content_delta') {
            text += event.delta;
            continue;
          }
          if (event.type === 'error') {
            // 流内错误事件不是异常，必须显式折成失败（否则会当成"空输出"）
            throw new RewriteLlmError('llm_failed', event.message || event.code);
          }
        }
      } catch (err) {
        if (err instanceof RewriteLlmError) throw err;
        if (timedOut) throw new RewriteLlmError('timeout', '改写模型调用超时');
        if (external?.aborted) throw new RewriteLlmError('aborted', '本轮已中止');
        throw new RewriteLlmError('llm_failed', err instanceof Error ? err.message : String(err));
      } finally {
        clearTimeout(timer);
        external?.removeEventListener('abort', onAbort);
      }
      // 这里补一次判定，否则超时 / 用户停止会被当成"空输出"，归因直接错档。
      if (timedOut) throw new RewriteLlmError('timeout', '改写模型调用超时');
      if (external?.aborted) throw new RewriteLlmError('aborted', '本轮已中止');
      return text;
    },
  };
}

function selectProvider(deps: RewriteLlmDeps, req: RewriteLlmRequest): LlmProvider {
  if (!req.model) return deps.llm();
  if (!deps.providerFor) {
    throw new RewriteLlmError(
      'llm_failed',
      `未装配 providerFor，无法按指定模型改写（model=${req.model.model}）`,
    );
  }
  return deps.providerFor(req.model);
}
