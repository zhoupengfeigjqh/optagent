import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmRetryOptions } from '../../src/config.js';
import { createStreamFn } from '../../src/infra/agent-loop.js';
import { PiAiLlmProvider } from '../../src/infra/llm/pi-ai-provider.js';
import type { LlmEvent } from '../../src/types.js';

const MODEL = deepseekProvider().getModels()[0]!;
const RETRY_2: LlmRetryOptions = { maxRetries: 2, maxRetryDelayMs: 15_000 };
const NO_RETRY: LlmRetryOptions = { maxRetries: 0, maxRetryDelayMs: 15_000 };

function providerWith(retry: LlmRetryOptions): PiAiLlmProvider {
  return new PiAiLlmProvider({ model: MODEL.id, apiKey: 'test-key' }, retry);
}

function chatChunk(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 0, model: MODEL.id, ...payload })}\n\n`;
}

/** OpenAI 兼容的成功流（含 usage：`streamChat` 的 done 分支要读它） */
function okStream(text: string): Response {
  const body =
    chatChunk({
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
    }) +
    chatChunk({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }) +
    chatChunk({
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }) +
    'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function errorResponse(status: number, message: string, type?: string): Response {
  const payload: Record<string, unknown> = { message };
  if (type) payload.type = type;
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function collect(provider: PiAiLlmProvider, signal?: AbortSignal): Promise<LlmEvent[]> {
  const events: LlmEvent[] = [];
  for await (const event of provider.streamChat({
    systemPrompt: '你是助手',
    messages: [{ role: 'user', content: '你好' }],
    tools: [],
    thinking: false,
    signal: signal ?? new AbortController().signal,
  })) {
    events.push(event);
  }
  return events;
}

function errorEventOf(events: LlmEvent[]): Extract<LlmEvent, { type: 'error' }> {
  const found = events.find((e): e is Extract<LlmEvent, { type: 'error' }> => e.type === 'error');
  if (!found)
    throw new Error(`未产出 error 事件，实际事件：${events.map((e) => e.type).join('、')}`);
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('直聊路径（streamChat）：重试是"有界且真的发生"', () => {
  it('连续两次 503 后成功：恰好 3 次请求，正文照常产出（不变式 1）', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls += 1;
      if (calls <= 2)
        return Promise.resolve(
          errorResponse(503, 'Service is too busy', 'service_unavailable_error'),
        );
      return Promise.resolve(okStream('好的'));
    });

    const events = await collect(providerWith(RETRY_2));

    expect(calls).toBe(3);
    expect(events.filter((e) => e.type === 'content_delta').map((e) => e.delta)).toEqual(['好的']);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  }, 15_000);

  it('重试关闭（maxRetries=0）：只发 1 次，失败码 LLM_UNAVAILABLE 且带诊断字段（不变式 1 的回退面）', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls += 1;
      return Promise.resolve(
        errorResponse(503, 'Service is too busy', 'service_unavailable_error'),
      );
    });

    const error = errorEventOf(await collect(providerWith(NO_RETRY)));

    expect(calls).toBe(1);
    expect(error.code).toBe('LLM_UNAVAILABLE');
    expect(error.upstream_status).toBe(503);
  });

  it('不可重试的错误（401）不重试：只发 1 次，失败码 LLM_UNAUTHORIZED（不变式 2）', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls += 1;
      return Promise.resolve(errorResponse(401, 'Authentication Fails', 'authentication_error'));
    });

    const error = errorEventOf(await collect(providerWith(RETRY_2)));

    expect(calls).toBe(1);
    expect(error.code).toBe('LLM_UNAUTHORIZED');
    expect(error.upstream_status).toBe(401);
  });

  it('重试等待期间中断：不再发起新请求，按 ABORTED 收尾（不变式 3）', async () => {
    const controller = new AbortController();
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls += 1;
      controller.abort();
      return Promise.resolve(errorResponse(503, 'Service is too busy'));
    });

    const error = errorEventOf(await collect(providerWith(RETRY_2), controller.signal));

    expect(calls).toBe(1);
    expect(error.code).toBe('ABORTED');
  });
});

describe('工具循环路径（createStreamFn）：重试口径与直聊完全一致', () => {
  it('把同一份 LlmRetryOptions 传给 pi 的 streamSimple，且不吞掉 pi-agent-core 的入参', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fakeProvider = {
      getModels: () => [MODEL],
      streamSimple: (_model: unknown, _context: unknown, options: Record<string, unknown>) => {
        seen.push(options);
        throw new Error('测试不需要真流：只断言入参');
      },
    };
    const signal = new AbortController().signal;
    const streamFn = createStreamFn(fakeProvider as never, 'test-key', RETRY_2);

    expect(() =>
      streamFn({ id: MODEL.id } as never, {} as never, { signal, reasoning: 'low' } as never),
    ).toThrow();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      signal,
      reasoning: 'low',
      apiKey: 'test-key',
      maxRetries: 2,
      maxRetryDelayMs: 15_000,
    });
  });

  it('重试关闭时传 0（与 pi 的"不重试"默认同义）', () => {
    const seen: Array<Record<string, unknown>> = [];
    const fakeProvider = {
      getModels: () => [MODEL],
      streamSimple: (_model: unknown, _context: unknown, options: Record<string, unknown>) => {
        seen.push(options);
        throw new Error('同上');
      },
    };

    expect(() =>
      createStreamFn(fakeProvider as never, 'test-key', NO_RETRY)(
        { id: MODEL.id } as never,
        {} as never,
        { signal: new AbortController().signal } as never,
      ),
    ).toThrow();

    expect(seen[0]).toMatchObject({ maxRetries: 0, maxRetryDelayMs: 15_000 });
  });
});
