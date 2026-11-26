import { describe, expect, it, vi } from 'vitest';

import type { AgentTool } from '@earendil-works/pi-agent-core';

import type {
  InteractionRequestInput,
  InteractionOutcome,
} from '../../src/domain/interaction-gate.js';
import { readToolError } from '../../src/domain/tool-error.js';
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
    expect(sink.requests[0]!.toolLabel).toBe('pricing: query_price');
    expect(sink.requests[0]!.toolDescription).toBe('查询电价');
    expect(sink.requests[0]!.schema).toEqual(SCHEMA);
    expect(sink.requests[0]!.proposedArgs).toEqual({ line: 'L01' });
    expect(tool.executeMock).toHaveBeenCalledTimes(1);
    expect(tool.executeMock).toHaveBeenCalledWith('call_1', { line: 'L02', qty: 5 });
  });

  it('reject：不调真实实现，返回「用户拒绝」文案并打失败标记（卡片标红）', async () => {
    const tool = makeTool();
    const sink = makeSink({ kind: 'reject', reason: 'user' });
    const wrapped = wrapToolWithInteraction(tool, sink);

    const result = await wrapped.execute('call_2', { line: 'L01' });

    expect(tool.executeMock).not.toHaveBeenCalled();
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('用户拒绝了本次调用'),
    });
    expect(readToolError(result.details)).toMatchObject({ code: 'HITL_REJECTED' });
  });

  it('expired：返回「等待超时」文案并打失败标记', async () => {
    const tool = makeTool();
    const sink = makeSink({ kind: 'expired' });
    const wrapped = wrapToolWithInteraction(tool, sink);

    const result = await wrapped.execute('call_3', { line: 'L01' });

    expect(tool.executeMock).not.toHaveBeenCalled();
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('等待超时'),
    });
    expect(readToolError(result.details)).toMatchObject({ code: 'HITL_EXPIRED' });
  });

  it('run 中断（drain 归因 aborted）：文案不能说成「用户拒绝」，同样标红', async () => {
    const tool = makeTool();
    const sink = makeSink({ kind: 'reject', reason: 'aborted' });
    const wrapped = wrapToolWithInteraction(tool, sink);

    const result = await wrapped.execute('call_abort', { line: 'L01' });

    expect(tool.executeMock).not.toHaveBeenCalled();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('本轮已中断');
    expect(text).not.toContain('用户拒绝');
    expect(readToolError(result.details)).toMatchObject({ code: 'HITL_ABORTED' });
  });

  it('submit 成功时**不带**失败标记（正常结果不能被误标红）', async () => {
    const tool = makeTool();
    const sink = makeSink({ kind: 'submit', args: { line: 'L02' } });
    const wrapped = wrapToolWithInteraction(tool, sink);

    const result = await wrapped.execute('call_ok', { line: 'L01' });

    expect(readToolError(result.details)).toBeUndefined();
  });

  it('包装后 name/label/description/parameters 与原工具一致', () => {
    const tool = makeTool();
    const wrapped = wrapToolWithInteraction(tool, makeSink({ kind: 'reject', reason: 'user' }));

    expect(wrapped.name).toBe(tool.name);
    expect(wrapped.label).toBe(tool.label);
    expect(wrapped.description).toBe(tool.description);
    expect(wrapped.parameters).toEqual(tool.parameters);
  });

  it('入参非对象（防御）：预填为空对象，不抛错', async () => {
    const tool = makeTool();
    const sink = makeSink({ kind: 'reject', reason: 'user' });
    const wrapped = wrapToolWithInteraction(tool, sink);

    await wrapped.execute('call_4', 'not-an-object');
    expect(sink.requests[0]!.proposedArgs).toEqual({});
  });

  it('executionMode 强制 sequential：并行批次不会同时产生多个挂起点（前端单槽位会丢）', () => {
    const wrapped = wrapToolWithInteraction(makeTool(), makeSink({ kind: 'reject', reason: 'user' }));

    expect(wrapped.executionMode).toBe('sequential');
  });

  it('规则字段声明：schema 含该字段时传入 sink；schema 不含时不传（服务级配置，工具是多个之一）', async () => {
    const withRules: AgentTool = {
      ...makeTool(),
      name: 'pricing__optimize',
      parameters: {
        type: 'object',
        properties: {
          rules: { type: 'array', items: { type: 'object' } },
          days: { type: 'integer' },
        },
      } as never,
    };

    const hitSink = makeSink({ kind: 'reject', reason: 'user' });
    await wrapToolWithInteraction(withRules, hitSink, 'rules').execute('call_r1', {});
    expect(hitSink.requests[0]!.rulesField).toBe('rules');

    const missSink = makeSink({ kind: 'reject', reason: 'user' });
    await wrapToolWithInteraction(makeTool(), missSink, 'rules').execute('call_r2', {});
    expect(missSink.requests[0]!.rulesField).toBeUndefined();

    const unsetSink = makeSink({ kind: 'reject', reason: 'user' });
    await wrapToolWithInteraction(withRules, unsetSink).execute('call_r3', {});
    expect(unsetSink.requests[0]!.rulesField).toBeUndefined();
  });

  it('规则字段路径：嵌套路径走得通时原样进快照；走不通一律不传', async () => {
    const nested: AgentTool = {
      ...makeTool(),
      name: 'hd-algorithm__hd_scheduling_submit',
      parameters: {
        type: 'object',
        properties: {
          input: {
            type: 'object',
            properties: {
              targetPriorities: { type: 'array', items: { type: 'object' } },
              solvingTime: { type: 'integer' },
            },
          },
        },
        required: ['input'],
      },
    } as never;

    const hitSink = makeSink({ kind: 'reject', reason: 'user' });
    await wrapToolWithInteraction(nested, hitSink, 'input.targetPriorities').execute('call_n1', {});
    expect(hitSink.requests[0]!.rulesField).toBe('input.targetPriorities');

    for (const path of ['input.missing', 'targetPriorities', 'input.targetPriorities.x']) {
      const missSink = makeSink({ kind: 'reject', reason: 'user' });
      await wrapToolWithInteraction(nested, missSink, path).execute('call_n2', {});
      expect(missSink.requests[0]!.rulesField).toBeUndefined();
    }
  });
});
