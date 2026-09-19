/**
 * 单元测试：工具交互包装器（tool-intercept，HITL）。
 *
 * 守住的语义：
 * - submit：真实 execute 收到**用户确认后**的 args（不是模型原始 args）
 * - reject / expired：不调真实实现，返回 isError 文案，模型据此收尾
 * - 包装保持 name/label/description/parameters 不变（模型侧无感）
 * - 包装器不含任何具体工具/MCP 服务名（解耦红线）
 */
import { describe, expect, it, vi } from 'vitest';

import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { InteractionRequestInput, InteractionOutcome } from '../../src/domain/interaction-gate.js';
import { wrapToolWithInteraction } from '../../src/infra/tool-intercept.js';

const SCHEMA = {
  type: 'object',
  properties: { line: { type: 'string' }, qty: { type: 'integer' } },
  required: ['line'],
} as const;

function makeTool(): AgentTool & { executeMock: ReturnType<typeof vi.fn> } {
  const executeMock = vi.fn(async (_callId: string, _params: unknown) => ({
    content: [{ type: 'text', text: 'ok' }],
    details: {},
  }));
  const tool: AgentTool = {
    name: 'pricing__query_price',
    label: 'pricing: query_price',
    description: '查询电价',
    parameters: SCHEMA as never,
    execute: executeMock as never,
  };
  return Object.assign(tool, { executeMock });
}

function makeSink(outcome: InteractionOutcome) {
  const requests: InteractionRequestInput[] = [];
  const sink = {
    requests,
    request: async (input: InteractionRequestInput) => {
      requests.push(input);
      return outcome;
    },
  };
  return sink;
}

describe('wrapToolWithInteraction', () => {
  it('submit：真实 execute 收到用户确认后的 args，且预填=模型原始 args', async () => {
    const tool = makeTool();
    const sink = makeSink({ kind: 'submit', args: { line: 'L02', qty: 5 } });
    const wrapped = wrapToolWithInteraction(tool, sink);

    await wrapped.execute('call_1', { line: 'L01' });

    expect(sink.requests).toHaveLength(1);
    expect(sink.requests[0]!.callId).toBe('call_1');
    expect(sink.requests[0]!.toolName).toBe('pricing__query_price');
    expect(sink.requests[0]!.toolDescription).toBe('查询电价'); // 工具级描述透传给弹窗快照
    expect(sink.requests[0]!.schema).toEqual(SCHEMA);
    expect(sink.requests[0]!.proposedArgs).toEqual({ line: 'L01' }); // 预填模型提议值
    expect(tool.executeMock).toHaveBeenCalledTimes(1);
    expect(tool.executeMock).toHaveBeenCalledWith('call_1', { line: 'L02', qty: 5 }); // 用户改后的值
  });

  it('reject：不调真实实现，返回「用户拒绝」文案', async () => {
    const tool = makeTool();
    const sink = makeSink({ kind: 'reject' });
    const wrapped = wrapToolWithInteraction(tool, sink);

    const result = await wrapped.execute('call_2', { line: 'L01' });

    expect(tool.executeMock).not.toHaveBeenCalled();
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('用户拒绝了本次调用'),
    });
  });

  it('expired：返回「等待超时」文案', async () => {
    const tool = makeTool();
    const sink = makeSink({ kind: 'expired' });
    const wrapped = wrapToolWithInteraction(tool, sink);

    const result = await wrapped.execute('call_3', { line: 'L01' });

    expect(tool.executeMock).not.toHaveBeenCalled();
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('等待超时'),
    });
  });

  it('包装后 name/label/description/parameters 与原工具一致', () => {
    const tool = makeTool();
    const wrapped = wrapToolWithInteraction(tool, makeSink({ kind: 'reject' }));

    expect(wrapped.name).toBe(tool.name);
    expect(wrapped.label).toBe(tool.label);
    expect(wrapped.description).toBe(tool.description);
    expect(wrapped.parameters).toEqual(tool.parameters);
  });

  it('入参非对象（防御）：预填为空对象，不抛错', async () => {
    const tool = makeTool();
    const sink = makeSink({ kind: 'reject' });
    const wrapped = wrapToolWithInteraction(tool, sink);

    await wrapped.execute('call_4', 'not-an-object');
    expect(sink.requests[0]!.proposedArgs).toEqual({});
  });
});
