import { describe, expect, it, vi } from 'vitest';

import { PLAN_TIMEOUT_MS } from '../../src/domain/plan/types.js';
import {
  callPlanWithTimeout,
  createPlanLlm,
  PlanCallTimeoutError,
} from '../../src/infra/plan-llm.js';
import type { LlmProvider } from '../../src/infra/llm/llm-provider.js';
import type { LlmEvent } from '../../src/types.js';

function providerOf(events: LlmEvent[]): { provider: LlmProvider; calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    provider: {
      async *streamChat(request) {
        calls.push(request);
        for (const event of events) yield event;
      },
    },
  };
}

describe('createPlanLlm', () => {
  it('把 content_delta 聚合成完整文本，且不带工具与思考', async () => {
    const { provider, calls } = providerOf([
      { type: 'content_delta', delta: '[{"seqId":1' },
      { type: 'content_delta', delta: '}]' },
      { type: 'done', usage: { inputTokens: 1, outputTokens: 2 } },
    ]);
    const plan = createPlanLlm(provider);

    const text = await plan({
      system: 'S',
      messages: [{ role: 'user', content: '帮我补采购' }],
      signal: new AbortController().signal,
    });

    expect(text).toBe('[{"seqId":1}]');
    expect(calls[0]).toMatchObject({ systemPrompt: 'S', tools: [], thinking: false });
  });

  it('错误事件转成异常（交由编排器计入重试）', async () => {
    const { provider } = providerOf([{ type: 'error', code: 'LLM_TIMEOUT', message: '超时' }]);
    const plan = createPlanLlm(provider);

    await expect(
      plan({ system: 'S', messages: [], signal: new AbortController().signal }),
    ).rejects.toThrow('超时');
  });

  it('透传 signal（用户点停止即中止规划）', async () => {
    const controller = new AbortController();
    const { provider, calls } = providerOf([]);
    const plan = createPlanLlm(provider);

    await plan({ system: 'S', messages: [], signal: controller.signal });

    expect((calls[0] as { signal: AbortSignal }).signal).toBe(controller.signal);
  });

  it('无增量时返回空串（由解析层判失败并重试）', async () => {
    const { provider } = providerOf([]);
    const plan = createPlanLlm(provider);
    expect(await plan({ system: 'S', messages: [], signal: new AbortController().signal })).toBe(
      '',
    );
    vi.restoreAllMocks();
  });
});

describe('callPlanWithTimeout', () => {
  it('到点即中止本次调用（编排器据此放弃，不重试）', async () => {
    vi.useFakeTimers();
    try {
      const plan = vi.fn(
        (request: { signal: AbortSignal }) =>
          new Promise<string>((_resolve, reject) => {
            request.signal.addEventListener('abort', () => reject(new Error('规划调用超时')));
          }),
      );

      const pending = callPlanWithTimeout(
        plan as never,
        { system: 'S', messages: [] },
        new AbortController().signal,
      );
      const assertion = expect(pending).rejects.toThrow('规划调用超时');

      await vi.advanceTimersByTimeAsync(PLAN_TIMEOUT_MS);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('provider 完全不响应 abort 时，也一定在超时点返回（不许挂死会话）', async () => {
    vi.useFakeTimers();
    try {
      const plan = vi.fn(() => new Promise<string>(() => undefined));

      const pending = callPlanWithTimeout(
        plan as never,
        { system: 'S', messages: [] },
        new AbortController().signal,
      );
      const assertion = expect(pending).rejects.toBeInstanceOf(PlanCallTimeoutError);

      await vi.advanceTimersByTimeAsync(PLAN_TIMEOUT_MS);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('用户先停：透传中止，不等超时', async () => {
    const controller = new AbortController();
    const plan = vi.fn(
      (request: { signal: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(new Error('用户停止')));
        }),
    );

    const pending = callPlanWithTimeout(
      plan as never,
      { system: 'S', messages: [] },
      controller.signal,
    );
    const assertion = expect(pending).rejects.toThrow('用户停止');
    controller.abort();
    await assertion;
    expect(controller.signal.aborted).toBe(true);
  });
});
