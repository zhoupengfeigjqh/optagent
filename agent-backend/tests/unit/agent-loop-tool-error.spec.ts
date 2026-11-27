import type { AssistantMessage } from '@earendil-works/pi-ai';
import { EventStream } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import { toolErrorResult } from '../../src/domain/tool-error.js';
import { runAgentLoopEvents } from '../../src/infra/agent-loop.js';
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

function makeTool(result: ReturnType<typeof toolErrorResult>): AgentTool {
  return {
    name: 'probe_tool',
    label: '探针工具',
    description: '测试用',
    parameters: { type: 'object', properties: {} } as never,
    execute: async () => result,
  };
}

async function runOnce(tool: AgentTool): Promise<LlmEvent[]> {
  let hop = 0;
  const events: LlmEvent[] = [];
  for await (const event of runAgentLoopEvents({
    model: {} as never,
    streamFn: (() => {
      hop += 1;
      return hop === 1
        ? fakeStream(
            assistant(
              [{ type: 'toolCall', id: 'call_1', name: 'probe_tool', arguments: {} }],
              'toolUse',
            ),
          )
        : fakeStream(assistant([{ type: 'text', text: '好的' }], 'stop'));
    }) as never,
    systemPrompt: 'test',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [tool],
    thinking: false,
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }
  return events;
}

describe('agent-loop 的 afterToolCall 接线：标记 → tool_call_end.status', () => {
  it('工具返回失败标记 → status=error（前端卡片标红、历史记 error）', async () => {
    const events = await runOnce(makeTool(toolErrorResult('工具执行失败：磁盘满了', 'TOOL_EXECUTION_FAILED')));

    const end = events.find((event) => event.type === 'tool_call_end');
    expect(end).toMatchObject({ type: 'tool_call_end', callId: 'call_1', status: 'error' });
    expect((end as { resultText?: string }).resultText).toContain('磁盘满了');
  });

  it('工具正常返回（没有标记）→ status=success，不被误标红', async () => {
    const events = await runOnce(makeTool({ content: [{ type: 'text', text: '一切正常' }], details: {} }));

    expect(events.find((event) => event.type === 'tool_call_end')).toMatchObject({
      status: 'success',
    });
  });

  it('工具真的抛异常（未走标记通道）→ 仍由 SDK 兜底成 error', async () => {
    const throwing: AgentTool = {
      name: 'probe_tool',
      description: '测试用',
      parameters: { type: 'object', properties: {} } as never,
      execute: async () => {
        throw new Error('炸了');
      },
    };

    const events = await runOnce(throwing);

    expect(events.find((event) => event.type === 'tool_call_end')).toMatchObject({
      status: 'error',
    });
  });
});
