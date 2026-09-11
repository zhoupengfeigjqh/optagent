/**
 * agent-loop 工具事件拦截单元测试（002 US1 / FR-001/002/003）。
 *
 * mock pi-agent-core 的 runAgentLoop，回放 AgentEvent 序列，
 * 验证 tool_execution_* → tool_call_start/end 的映射：
 * 仅透传 callId/name/status，args/result/partialResult 永不复制。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { LlmEvent } from '../../src/types';

// runAgentLoop 替身：捕获 emit 回调，回放脚本后 resolve
const scripts: AgentEvent[][] = [];
vi.mock('@earendil-works/pi-agent-core', () => ({
  runAgentLoop: vi.fn(
    (
      _prompts: unknown,
      _ctx: unknown,
      _opts: unknown,
      emit: (e: AgentEvent) => void,
      _signal: AbortSignal,
    ) => {
      const script = scripts.shift() ?? [];
      for (const e of script) emit(e);
      return Promise.resolve();
    },
  ),
}));

import { runAgentLoopEvents } from '../../src/infra/agent-loop';

function baseOpts() {
  return {
    model: {} as never,
    streamFn: (() => {}) as never,
    systemPrompt: '',
    messages: [],
    tools: [],
    thinking: false,
    signal: new AbortController().signal,
  };
}

async function collect(events: AgentEvent[]): Promise<LlmEvent[]> {
  scripts.push(events);
  const out: LlmEvent[] = [];
  for await (const e of runAgentLoopEvents(baseOpts())) out.push(e);
  return out;
}

const agentEnd: AgentEvent = { type: 'agent_end', messages: [] } as AgentEvent;

describe('agent-loop 工具事件拦截', () => {
  beforeEach(() => {
    scripts.length = 0;
  });

  it('tool_execution_start → tool_call_start（仅 callId+name，无 args）', async () => {
    const events = await collect([
      {
        type: 'tool_execution_start',
        toolCallId: 'c1',
        toolName: 'read_file',
        args: { path: '/secret/path' },
      } as AgentEvent,
      agentEnd,
    ]);
    expect(events).toEqual([
      { type: 'tool_call_start', callId: 'c1', name: 'read_file' },
      { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
    ]);
    expect(JSON.stringify(events)).not.toContain('/secret/path');
    expect(JSON.stringify(events)).not.toContain('args');
  });

  it('tool_execution_end → tool_call_end（仅状态，无 result）；isError 映射为 error', async () => {
    const events = await collect([
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'grep_files', args: {} } as AgentEvent,
      {
        type: 'tool_execution_end',
        toolCallId: 'c1',
        toolName: 'grep_files',
        result: { secret: '命中内容不应透出' },
        isError: true,
      } as AgentEvent,
      agentEnd,
    ]);
    expect(events[0]).toEqual({ type: 'tool_call_start', callId: 'c1', name: 'grep_files' });
    expect(events[1]).toEqual({ type: 'tool_call_end', callId: 'c1', status: 'error' });
    expect(JSON.stringify(events)).not.toContain('命中内容不应透出');
    expect(JSON.stringify(events)).not.toContain('result');
  });

  it('tool_execution_update 不透出（partialResult 属于结果内容）', async () => {
    const events = await collect([
      {
        type: 'tool_execution_update',
        toolCallId: 'c1',
        toolName: 'read_file',
        args: {},
        partialResult: '部分内容',
      } as AgentEvent,
      agentEnd,
    ]);
    expect(events).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]);
  });

  it('多次调用按序成对，callId 可区分', async () => {
    const events = await collect([
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'list_dir', args: {} } as AgentEvent,
      { type: 'tool_execution_start', toolCallId: 'c2', toolName: 'read_file', args: {} } as AgentEvent,
      { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'list_dir', result: {}, isError: false } as AgentEvent,
      { type: 'tool_execution_end', toolCallId: 'c2', toolName: 'read_file', result: {}, isError: false } as AgentEvent,
      agentEnd,
    ]);
    expect(events.map((e) => e.type)).toEqual([
      'tool_call_start',
      'tool_call_start',
      'tool_call_end',
      'tool_call_end',
      'done',
    ]);
    expect(events[2]).toMatchObject({ callId: 'c1', status: 'success' });
    expect(events[3]).toMatchObject({ callId: 'c2', status: 'success' });
  });
});
