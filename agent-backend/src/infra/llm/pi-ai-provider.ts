/**
 * LlmProvider 的 pi-ai 实现：deepseek provider（openai-completions API）。
 *
 * - 模型取 config.yaml models 列表条目（默认第一项）；base_url 可覆盖
 * - thinking 开关映射为 pi 的 reasoning 档位（开=low，关=off）
 * - usage 从 done 事件的 message.usage 提取
 * - api_key 走请求级 options.apiKey，不依赖进程环境变量
 */
import type { Model, Provider } from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { LlmRetryOptions, ModelEntry } from '../../config.js';
import { classifyLlmFailure, statusOfError } from '../../domain/llm-error.js';
import type { LlmEvent } from '../../types.js';
import { createStreamFn } from '../agent-loop.js';
import type { LlmChatRequest, LlmProvider } from './llm-provider.js';

export class PiAiLlmProvider implements LlmProvider {
  private readonly provider: Provider<'openai-completions'>;
  private readonly model: Model<'openai-completions'>;
  private readonly apiKey: string;
  private readonly retry: LlmRetryOptions;

  constructor(entry: ModelEntry, retry: LlmRetryOptions) {
    this.provider = deepseekProvider();
    const found = this.provider.getModels().find((m) => m.id === entry.model);
    if (!found) {
      throw new Error(`pi-ai 模型目录中不存在模型 ${entry.model}（provider: deepseek）`);
    }
    this.model = entry.baseUrl ? { ...found, baseUrl: entry.baseUrl } : found;
    this.apiKey = entry.apiKey;
    this.retry = retry;
  }

  /** agent-loop 路径（带工具时）所需的 pi 低层参数 */
  loopOptions(): { model: Model<never>; streamFn: StreamFn } {
    return {
      model: this.model as Model<never>,
      streamFn: createStreamFn(this.provider, this.apiKey, this.retry),
    };
  }

  async *streamChat(req: LlmChatRequest): AsyncIterable<LlmEvent> {
    const context = {
      systemPrompt: req.systemPrompt,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: Date.now(),
      })),
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters as never,
      })),
    };
    const stream = this.provider.streamSimple(this.model, context as never, {
      ...(req.thinking ? { reasoning: 'low' as const } : {}),
      signal: req.signal,
      apiKey: this.apiKey,
      // 有界重试交给 pi-ai 既有的 retryProviderRequest（§19.1）：重试发生在响应到达之前，
      // 因此不会出现"重复正文"；退避睡眠可被 signal 打断（用户点「停止」立即生效）
      maxRetries: this.retry.maxRetries,
      maxRetryDelayMs: this.retry.maxRetryDelayMs,
    });
    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'thinking_delta':
            yield { type: 'thinking_delta', delta: event.delta };
            break;
          case 'text_delta':
            yield { type: 'content_delta', delta: event.delta };
            break;
          case 'done':
            yield {
              type: 'done',
              usage: {
                inputTokens: event.message.usage.input,
                outputTokens: event.message.usage.output,
              },
            };
            break;
          case 'error':
            // 分类唯一实现（`domain/llm-error.ts`）：上游状态码 → 错误码 + 诊断字段，
            // 与工具循环路径（`agent-loop.ts`）产出同一套取值
            yield {
              type: 'error',
              ...classifyLlmFailure({
                ...(event.error.errorMessage ? { message: event.error.errorMessage } : {}),
                ...(event.reason === 'aborted' ? { aborted: true } : {}),
              }),
            };
            break;
          default:
            break; // start/text_start/text_end/thinking_* 边界事件不需透传
        }
      }
    } catch (err) {
      const status = statusOfError(err);
      yield {
        type: 'error',
        ...classifyLlmFailure({
          message: err instanceof Error ? err.message : String(err),
          ...(status !== undefined ? { status } : {}),
        }),
      };
    }
  }
}
