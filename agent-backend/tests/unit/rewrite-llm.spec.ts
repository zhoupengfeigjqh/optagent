/**
 * 单元测试：改写调用适配器（027）。
 *
 * 守五条契约级要求（契约 §6）：
 * - `tools: []`、`thinking: false`（改写不许走工具循环、不许混思考内容）；
 * - 只聚合 `content_delta`，`thinking_delta` 丢掉；
 * - 流内 `error` 事件折成失败（不是"空输出"）；
 * - 超时与"本轮中止"都能真的打断调用，且**原因可区分**；
 * - 请求级模型选择走 `providerFor`，缺省时**不静默换模型**。
 */
import { describe, expect, it, vi } from 'vitest';
import type { LlmEvent, ModelSelection } from '../../src/types.js';
import type { LlmChatRequest, LlmProvider } from '../../src/infra/llm/llm-provider.js';
import { RewriteLlmError, createRewriteLlm } from '../../src/infra/rewrite-llm.js';

const REQ = {
  systemPrompt: '你是输入改写助手',
  messages: [{ role: 'user' as const, content: '【当前输入】\n分析它' }],
  timeoutMs: 1000,
};

/** 一次性 provider：记录收到的请求，按脚本产出事件 */
function scripted(events: readonly LlmEvent[]): { provider: LlmProvider; calls: LlmChatRequest[] } {
  const calls: LlmChatRequest[] = [];
  const provider: LlmProvider = {
    async *streamChat(req: LlmChatRequest) {
      calls.push(req);
      for (const event of events) yield event;
    },
  };
  return { provider, calls };
}

/** 一直等到 signal 中止才收尾的 provider（模拟真实网络调用） */
function hanging(): LlmProvider {
  return {
    // 故意不产出任何事件：只等中止信号（等价于"模型一直没吐字"）
    // eslint-disable-next-line require-yield
    async *streamChat(req: LlmChatRequest) {
      await new Promise<void>((resolve) => {
        if (req.signal.aborted) {
          resolve();
          return;
        }
        req.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  };
}

describe('createRewriteLlm —— 正常路径', () => {
  it('只聚合 content_delta，丢弃 thinking_delta；请求固定 tools: [] / thinking: false', async () => {
    const { provider, calls } = scripted([
      { type: 'thinking_delta', delta: '内部推理' },
      { type: 'content_delta', delta: '分析上批' },
      { type: 'content_delta', delta: '采购单的到货延迟' },
      { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const llm = createRewriteLlm({ llm: () => provider });

    const text = await llm.complete(REQ);

    expect(text).toBe('分析上批采购单的到货延迟');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tools).toEqual([]);
    expect(calls[0]!.thinking).toBe(false);
    expect(calls[0]!.systemPrompt).toBe(REQ.systemPrompt);
    expect(calls[0]!.messages).toEqual(REQ.messages);
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it('无内容（全是 thinking / 空流）时返回空串，由调用方判 empty_output', async () => {
    const { provider } = scripted([]);
    const llm = createRewriteLlm({ llm: () => provider });

    await expect(llm.complete(REQ)).resolves.toBe('');
  });
});

describe('createRewriteLlm —— 失败与中止', () => {
  it('流内 error 事件 → llm_failed（不是空输出）', async () => {
    const { provider } = scripted([
      { type: 'content_delta', delta: '半截' },
      { type: 'error', code: 'LLM_ERROR', message: '上游 503' },
    ]);
    const llm = createRewriteLlm({ llm: () => provider });

    const error = await llm.complete(REQ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RewriteLlmError);
    expect((error as RewriteLlmError).reason).toBe('llm_failed');
    expect((error as Error).message).toContain('503');
  });

  it('provider 抛错 → llm_failed（原因原样带出）', async () => {
    const provider: LlmProvider = {
      // eslint-disable-next-line require-yield
      async *streamChat() {
        throw new Error('连接被重置');
      },
    };
    const llm = createRewriteLlm({ llm: () => provider });

    const error = await llm.complete(REQ).catch((err: unknown) => err);

    expect((error as RewriteLlmError).reason).toBe('llm_failed');
    expect((error as Error).message).toContain('连接被重置');
  });

  it('超时 → reason=timeout（并真的打断 provider 的等待）', async () => {
    const llm = createRewriteLlm({ llm: () => hanging() });

    const error = await llm.complete({ ...REQ, timeoutMs: 20 }).catch((err: unknown) => err);

    expect((error as RewriteLlmError).reason).toBe('timeout');
  });

  it('本轮中止信号 → reason=aborted（与超时区分开）', async () => {
    const llm = createRewriteLlm({ llm: () => hanging() });
    const controller = new AbortController();
    const pending = llm.complete({ ...REQ, timeoutMs: 5000, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);

    const error = await pending.catch((err: unknown) => err);

    expect((error as RewriteLlmError).reason).toBe('aborted');
  });

  it('传入前就已中止的信号 → 立即失败，不发起等待', async () => {
    const controller = new AbortController();
    controller.abort();
    const llm = createRewriteLlm({ llm: () => hanging() });

    const error = await llm
      .complete({ ...REQ, timeoutMs: 5000, signal: controller.signal })
      .catch((err: unknown) => err);

    expect((error as RewriteLlmError).reason).toBe('aborted');
  });
});

describe('createRewriteLlm —— 请求级模型选择', () => {
  const MODEL: ModelSelection = { model: 'm-2', apiKey: 'k-2', baseUrl: 'http://llm:8000' };

  it('传 model 时用 providerFor 建临时 provider（不走默认单例）', async () => {
    const { provider: chosen, calls } = scripted([
      { type: 'content_delta', delta: '改写结果' },
    ]);
    const defaultSpy = vi.fn();
    const providerFor = vi.fn(() => chosen);
    const llm = createRewriteLlm({ llm: defaultSpy, providerFor });

    await expect(llm.complete({ ...REQ, model: MODEL })).resolves.toBe('改写结果');
    expect(providerFor).toHaveBeenCalledWith(MODEL);
    expect(defaultSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('不传 model 时用默认 provider', async () => {
    const { provider } = scripted([{ type: 'content_delta', delta: 'x' }]);
    const defaultSpy = vi.fn(() => provider);
    const providerFor = vi.fn();
    const llm = createRewriteLlm({ llm: defaultSpy, providerFor });

    await expect(llm.complete(REQ)).resolves.toBe('x');
    expect(defaultSpy).toHaveBeenCalledTimes(1);
    expect(providerFor).not.toHaveBeenCalled();
  });

  it('传了 model 却没有 providerFor → 明确失败（不静默降级到默认模型）', async () => {
    const defaultSpy = vi.fn();
    const llm = createRewriteLlm({ llm: defaultSpy });

    const error = await llm.complete({ ...REQ, model: MODEL }).catch((err: unknown) => err);

    expect((error as RewriteLlmError).reason).toBe('llm_failed');
    expect((error as Error).message).toContain('providerFor');
    expect(defaultSpy).not.toHaveBeenCalled();
  });
});
