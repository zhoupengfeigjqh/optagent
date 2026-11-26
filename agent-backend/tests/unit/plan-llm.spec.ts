/**
 * 单元测试：规划调用适配（028 FR-004）。
 *
 * 守住三条口径：非流式聚合（把增量拼成完整文本）、`tools: []` + `thinking: false`、
 * 错误事件转成异常交给编排器重试。
 */
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

/**
 * 硬超时（NFR-001 / SC-005 的「20 秒是上限」那一半）。
 *
 * P90 延迟需要真机样本（T803 登记为上线后观测），但「到点必须返回、不许无限等」
 * 是纯逻辑，可以在这里钉死：否则超时预算与延迟指标会自相矛盾。
 *
 * 2026-11-26：上限由 5s 提到 20s（规划提示词含全量本体 + 全工具），并新增
 * `Promise.race`——`abort()` 只是发信号，provider 不听也不会把本轮挂死。
 */
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
      // 既不 settle 也不看 signal：模拟"上游卡死/半开连接"
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
