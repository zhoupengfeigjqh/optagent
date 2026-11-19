/**
 * 单元测试：模型 id 的**别名解析**（`MODEL_ALIASES`）
 *
 * 背景（2026-11-18）：`config.yaml` 允许写厂商别名（如 `deepseek-flash`），但 pi-ai 的
 * meta 目录里只有正式 id `deepseek-v4-flash`。此前直接按 id 查目录 ⇒ 构造期抛错 ⇒
 * 整轮以 INTERNAL_ERROR 失败（前端显示「系统繁忙，请稍后重试」）。
 *
 * 三条不变式：
 * ① 别名可构造，且**请求体发出的 model 就是配置原值**（配置写什么就发什么）；
 * ② 元数据借用正式 id 那份（窗口 / compat / 计价不丢）；
 * ③ 未登记的 id 仍然快速失败，且错误里给出可选清单与已登记别名（可操作性，原则九）。
 *
 * 全程不碰网络：构造期只读本地目录，不发请求。
 */
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmRetryOptions } from '../../src/config.js';
import { PiAiLlmProvider } from '../../src/infra/llm/pi-ai-provider.js';
import type { LlmEvent } from '../../src/types.js';

const NO_RETRY: LlmRetryOptions = { maxRetries: 0, maxRetryDelayMs: 1_000 };

/** OpenAI 兼容的成功流（最小可用：一个正文片 + 结束标记） */
function okStream(text: string): Response {
  const chunk = (payload: Record<string, unknown>): string =>
    `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, ...payload })}\n\n`;
  const body =
    chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] }) +
    chunk({ choices: [{ index: 0, delta: { content: text } }] }) +
    chunk({
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }) +
    'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PiAiLlmProvider —— 模型 id 别名解析', () => {
  it('别名 deepseek-flash：构造成功，且请求用别名、元数据用正式 id', () => {
    const provider = new PiAiLlmProvider({ model: 'deepseek-flash', apiKey: 'test-key' }, NO_RETRY);
    const { model } = provider.loopOptions();

    // ① 配置写什么，发什么（前端下拉 / config.yaml / 请求体三者同源）
    expect(model.id).toBe('deepseek-flash');

    // ② 元数据来自目录里的 deepseek-v4-flash 那一份，不是凭空的默认值
    const official = deepseekProvider()
      .getModels()
      .find((m) => m.id === 'deepseek-v4-flash');
    expect(official).toBeDefined();
    expect(model.contextWindow).toBe(official!.contextWindow);
    expect(model.maxTokens).toBe(official!.maxTokens);
    expect(model.cost).toEqual(official!.cost);
  });

  it('目录内的正式 id 原样通过（别名层不干扰）', () => {
    const provider = new PiAiLlmProvider({ model: 'deepseek-v4-pro', apiKey: 'k' }, NO_RETRY);
    expect(provider.loopOptions().model.id).toBe('deepseek-v4-pro');
  });

  it('别名 + base_url 覆盖同时生效', () => {
    const provider = new PiAiLlmProvider(
      { model: 'deepseek-flash', apiKey: 'k', baseUrl: 'https://proxy.example/v1' },
      NO_RETRY,
    );
    const { model } = provider.loopOptions();
    expect(model.id).toBe('deepseek-flash');
    expect(model.baseUrl).toBe('https://proxy.example/v1');
  });

  it('未登记的 id：快速失败，且错误里列出可选 id 与已登记别名', () => {
    expect(() => new PiAiLlmProvider({ model: 'deepseek-flash-x', apiKey: 'k' }, NO_RETRY)).toThrow(
      /不存在模型 deepseek-flash-x/,
    );
    try {
      new PiAiLlmProvider({ model: 'deepseek-flash-x', apiKey: 'k' }, NO_RETRY);
    } catch (err) {
      const text = (err as Error).message;
      expect(text).toContain('可选：');
      expect(text).toContain('deepseek-v4-flash');
      expect(text).toContain('已登记别名：deepseek-flash');
    }
  });

  it('别名在**请求体**里原样发出（不是目录里的正式 id）', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', (_url: unknown, init: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Promise.resolve(okStream('好'));
    });

    const provider = new PiAiLlmProvider({ model: 'deepseek-flash', apiKey: 'k' }, NO_RETRY);
    const events: LlmEvent[] = [];
    for await (const event of provider.streamChat({
      systemPrompt: '你是助手',
      messages: [{ role: 'user', content: '你好' }],
      tools: [],
      thinking: false,
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(bodies).toHaveLength(1);
    // 上游按别名受理：请求体必须是配置原值，而不是被替换成目录内的正式 id
    expect(bodies[0]!.model).toBe('deepseek-flash');
    expect(events.some((e) => e.type === 'content_delta')).toBe(true);
  }, 15_000);
});
