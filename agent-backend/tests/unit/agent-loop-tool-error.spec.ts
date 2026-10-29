/**
 * 端到端（进程内）：工具失败标记 → SSE 状态口径的**接线**验证（2026-10-29）。
 *
 * 为什么要有这一条：`domain/tool-error.ts` 的单测只能证明"标记长什么样"，
 * 证明不了 pi 的 loop **真的会把标记翻成 `isError`**。中间那一步靠的是
 * `runAgentLoop` 的 `afterToolCall` patch（`finalizeExecutedToolCall`），
 * 一旦 SDK 升级改了 patch 语义，没有这条用例就会**静默**退回"绿卡片"。
 *
 * 判据：`tool_execution_end.isError` → `agent-loop.ts` 映射的
 * `tool_call_end.status`（`'error' | 'success'`），这正是前端卡片与
 * `tool-events.jsonl` 的唯一来源。
 *
 * 用假 `streamFn` 驱动两跳：第一跳模型发起工具调用，第二跳收尾。
 */
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

/** 一跳的假流：start（带 partial）+ done（带最终 message） */
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

/** 工具结果由用例决定：带标记 = 失败，普通文本 = 成功 */
function makeTool(result: ReturnType<typeof toolErrorResult>): AgentTool {
  return {
    name: 'probe_tool',
    label: '探针工具',
    description: '测试用',
    parameters: { type: 'object', properties: {} } as never,
    execute: async () => result,
  };
}

/** 跑一轮：第一跳调用工具，第二跳收尾 */
async function runOnce(tool: AgentTool): Promise<LlmEvent[]> {
  let hop = 0;
  const events: LlmEvent[] = [];
  for await (const event of runAgentLoopEvents({
    model: {} as never,
    // 第一跳：模型发起一次工具调用；第二跳：纯文本收尾
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
    // 正文照旧上行（落盘与卡片展开都靠它）
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
