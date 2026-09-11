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
import type { ModelEntry } from '../../config.js';
import type { LlmEvent } from '../../types.js';
import { createStreamFn } from '../agent-loop.js';
import type { LlmChatRequest, LlmProvider } from './llm-provider.js';

export class PiAiLlmProvider implements LlmProvider {
  private readonly provider: Provider<'openai-completions'>;
  private readonly model: Model<'openai-completions'>;
  private readonly apiKey: string;

  constructor(entry: ModelEntry) {
    this.provider = deepseekProvider();
    const found = this.provider.getModels().find((m) => m.id === entry.model);
    if (!found) {
      throw new Error(`pi-ai 模型目录中不存在模型 ${entry.model}（provider: deepseek）`);
    }
    this.model = entry.baseUrl ? { ...found, baseUrl: entry.baseUrl } : found;
    this.apiKey = entry.apiKey;
  }

  /** agent-loop 路径（带工具时）所需的 pi 低层参数 */
  loopOptions(): { model: Model<never>; streamFn: StreamFn } {
    return {
      model: this.model as Model<never>,
      streamFn: createStreamFn(this.provider, this.apiKey),
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
              code: event.reason === 'aborted' ? 'ABORTED' : 'LLM_ERROR',
              message: event.error.errorMessage ?? 'LLM 调用失败',
            };
            break;
          default:
            break; // start/text_start/text_end/thinking_* 边界事件不需透传
        }
      }
    } catch (err) {
      yield {
        type: 'error',
        code: 'LLM_ERROR',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
