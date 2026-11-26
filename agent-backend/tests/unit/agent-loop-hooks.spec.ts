import type { AssistantMessage } from '@earendil-works/pi-ai';
import { EventStream } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import { runAgentLoopEvents, type RunAgentLoopHooks } from '../../src/infra/agent-loop.js';
import { toolErrorResult } from '../../src/domain/tool-error.js';
import type { LlmEvent } from '../../src/types.js';

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(content: unknown[], stopReason: 'toolUse' | 'stop'): AssistantMessage {
  return { role: 'assistant', content, stopReason, usage: USAGE, timestamp: Date.now() } as never;
}

function fakeStream(message: AssistantMessage) {
  const stream = new EventStream(
    (event: { type: string }) => event.type === 'done' || event.type === 'error',
    (event: { type: string; message?: unknown; error?: unknown }) =>
      event.type === 'done' ? event.message : event.error,
  );
  queueMicrotask(() => {
    stream.push({ type: 'start', partial: message });
    stream.push({ type: 'done', reason: message.stopReason, message });
  });
  return stream as never;
}

function tool(name: string, result: unknown = { content: [{ type: 'text', text: 'ok' }], details: {} }): AgentTool {
  return {
    name,
    label: name,
    description: '测试用',
    parameters: { type: 'object', properties: {} } as never,
    execute: async () => result as never,
  };
}

const TEXT_ONLY = assistant([{ type: 'text', text: '好的' }], 'stop');
const TOOL_CALL = assistant(
  [{ type: 'toolCall', id: 'call_1', name: 'probe_tool', arguments: {} }],
  'toolUse',
);

interface HopContext {
  systemPrompt?: string;
  messages?: Array<{ role: string; content: unknown }>;
  tools?: Array<{ name: string }>;
}

async function drive(opts: {
  script: AssistantMessage[];
  tools?: AgentTool[];
  hooks?: RunAgentLoopHooks;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<{ events: LlmEvent[]; contexts: HopContext[] }> {
  let hop = 0;
  const contexts: HopContext[] = [];
  const events: LlmEvent[] = [];

  for await (const event of runAgentLoopEvents({
    model: {} as never,
    streamFn: ((_model: unknown, context: HopContext) => {
      contexts.push(context);
      const message = opts.script[Math.min(hop, opts.script.length - 1)]!;
      hop += 1;
      return fakeStream(message);
    }) as never,
    systemPrompt: 'SYS',
    messages: opts.messages ?? [{ role: 'user', content: 'hi' }],
    tools: opts.tools ?? [tool('probe_tool')],
    thinking: false,
    signal: new AbortController().signal,
    ...(opts.hooks !== undefined ? { hooks: opts.hooks } : {}),
  })) {
    events.push(event);
  }
  return { events, contexts };
}

describe('028 钩子透传', () => {
  it('SC-006：不传 hooks 时四个钩子一次都不被调用', async () => {
    const { events, contexts } = await drive({ script: [TOOL_CALL, TEXT_ONLY] });

    expect(contexts).toHaveLength(2);
    expect(events.some((event) => event.type === 'done')).toBe(true);
    expect(contexts[0]?.tools?.map((item) => item.name)).toEqual(['probe_tool']);
  });

  it('prepareNextTurn 替换的工具集与系统提示进入下一跳', async () => {
    const prepareNextTurn = vi.fn(() => ({
      context: { systemPrompt: 'SYS2', messages: [{ role: 'user', content: '改写后' }], tools: [tool('only_me')] },
    }));

    const { contexts } = await drive({ script: [TOOL_CALL, TEXT_ONLY], hooks: { prepareNextTurn } });

    expect(prepareNextTurn).toHaveBeenCalledTimes(1);
    expect(contexts[1]?.systemPrompt).toBe('SYS2');
    expect(contexts[1]?.tools?.map((item) => item.name)).toEqual(['only_me']);
    expect(contexts[1]?.messages?.at(-1)?.content).toBe('改写后');
  });

  it('afterToolCall 在失败翻牌**之前**看到原始 result，翻牌仍由本层完成', async () => {
    const seen = vi.fn();
    const failing = tool(
      'probe_tool',
      toolErrorResult('前置函数未满足', 'RULE_FUNCTIONS_MISSING_CODE'),
    );

    const { events } = await drive({
      script: [TOOL_CALL, TEXT_ONLY],
      tools: [failing],
      hooks: {
        afterToolCall: async (context) => {
          seen((context.result as { details?: { toolError?: unknown } }).details?.toolError);
        },
      },
    });

    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0]?.[0]).toBeDefined();
    expect(events.find((event) => event.type === 'tool_call_end')).toMatchObject({ status: 'error' });
  });

  it('getFollowUpMessages 追加的消息触发下一跳，且落在上下文末尾', async () => {
    let followUps = 0;
    const { contexts } = await drive({
      script: [TEXT_ONLY, TEXT_ONLY],
      hooks: {
        // 只追加一次，否则 loop 会一直续跑（这正是编排器里 `enqueued` 上限保护的原因）
        getFollowUpMessages: () => {
          followUps += 1;
          return (followUps === 1 ? [{ role: 'user', content: '继续下一步' }] : []) as never;
        },
      },
    });

    expect(contexts).toHaveLength(2);
    expect(contexts[1]?.messages?.at(-1)?.content).toBe('继续下一步');
  });

  it('shouldStopAfterTurn 返回真即收尾，不再发下一跳', async () => {
    const { events, contexts } = await drive({
      script: [TEXT_ONLY, TEXT_ONLY],
      hooks: { shouldStopAfterTurn: () => true },
    });

    expect(contexts).toHaveLength(1);
    expect(events.some((event) => event.type === 'done')).toBe(true);
  });
});
