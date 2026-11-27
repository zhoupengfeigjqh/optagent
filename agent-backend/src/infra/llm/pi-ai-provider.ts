import type { Model, Provider } from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { LlmRetryOptions, ModelEntry } from '../../config.js';
import { classifyLlmFailure, statusOfError } from '../../domain/llm-error.js';
import type { LlmEvent } from '../../types.js';
import { createStreamFn } from '../agent-loop.js';
import type { LlmChatRequest, LlmProvider } from './llm-provider.js';

const MODEL_ALIASES: Readonly<Record<string, string>> = {
  'deepseek-flash': 'deepseek-v4-flash',
};

export class PiAiLlmProvider implements LlmProvider {
  private readonly provider: Provider<'openai-completions'>;
  private readonly model: Model<'openai-completions'>;
  private readonly apiKey: string;
  private readonly retry: LlmRetryOptions;

  constructor(entry: ModelEntry, retry: LlmRetryOptions) {
    this.provider = deepseekProvider();
    const models = this.provider.getModels();
    const catalogId = MODEL_ALIASES[entry.model] ?? entry.model;
    const found = models.find((m) => m.id === catalogId);
    if (!found) {
      throw new Error(
        `pi-ai 模型目录中不存在模型 ${entry.model}（provider: deepseek）；` +
          `可选：${models.map((m) => m.id).join(' / ')}；` +
          `已登记别名：${Object.keys(MODEL_ALIASES).join(' / ') || '无'}`,
      );
    }
    this.model = {
      ...found,
      id: entry.model,
      ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
    };
    this.apiKey = entry.apiKey;
    this.retry = retry;
  }

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
            yield {
              type: 'error',
              ...classifyLlmFailure({
                ...(event.error.errorMessage ? { message: event.error.errorMessage } : {}),
                ...(event.reason === 'aborted' ? { aborted: true } : {}),
              }),
            };
            break;
          default:
            break;
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
