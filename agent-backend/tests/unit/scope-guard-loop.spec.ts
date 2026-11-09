/**
 * 端到端（进程内）：权限闸门 → 工具失败标记 → SSE 状态口径的**接线**验证（020）。
 *
 * 为什么要有这一条：包装器的单测只能证明"返回了什么"，证明不了 pi 的 loop
 * 真的把失败标记翻成 `isError` 并映射到 `tool_call_end.status='error'`
 * （前端卡片标红、历史记 error 的唯一来源）。
 *
 * 判据（契约 C9）：被拒调用 → 真实实现零执行 + `tool_call_end.status='error'`
 * + 正文含拒绝文案；放行调用 → 真实实现执行 + `status='success'`。
 */
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { EventStream } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScopeGuard } from '../../src/domain/scope-guard/index.js';
import { runAgentLoopEvents } from '../../src/infra/agent-loop.js';
import { guardTools, wrapToolWithScopeGuard } from '../../src/infra/tool-scope-guard.js';
import type { LlmEvent } from '../../src/types.js';

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const tmpDirs: string[] = [];

function tmpAgentDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-scope-guard-loop-'));
  tmpDirs.push(dir);
  return dir;
}

function writeOntology(agentDir: string, scope: string): void {
  const dir = path.join(agentDir, 'ontology', '生产调度', '原材料采购和库存');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'ontology.yaml'),
    [
      'metadata:',
      '  ontology_name: 原材料采购和库存',
      '  scenario_name: 生产调度',
      'behaviors:',
      '  - name: probe_tool',
      '    title: 探针工具',
      '    op_type: command',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'securities.yaml'),
    ['securities:', '  - action_name: probe_tool', '    scope:', `      - ${scope}`].join('\n'),
    'utf8',
  );
}

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

/** 多跳脚本：模型"固执地"继续调工具时的真实 loop 行为 */
async function runScript(tools: AgentTool[], steps: AssistantMessage[]): Promise<LlmEvent[]> {
  let hop = 0;
  const events: LlmEvent[] = [];
  for await (const event of runAgentLoopEvents({
    model: {} as never,
    streamFn: (() => {
      hop += 1;
      return fakeStream(steps[Math.min(hop - 1, steps.length - 1)]!);
    }) as never,
    systemPrompt: 'test',
    messages: [{ role: 'user', content: 'hi' }],
    tools,
    thinking: false,
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }
  return events;
}

function makeTool(name: string) {
  const executeMock = vi.fn(async () => ({
    content: [{ type: 'text', text: 'executed' }],
    details: {},
  }));
  const tool: AgentTool = {
    name,
    label: name,
    description: '测试用',
    parameters: { type: 'object', properties: {} } as never,
    execute: executeMock as never,
  };
  return Object.assign(tool, { executeMock });
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('权限闸门 → loop 接线', () => {
  it('未授权：工具零执行，tool_call_end 为 error，正文为拒绝文案', async () => {
    const agentDir = tmpAgentDir();
    writeOntology(agentDir, 'zpf');
    const guard = createScopeGuard({ agentDir, username: 'admin' });

    const executeMock = vi.fn(async () => ({
      content: [{ type: 'text', text: 'should-not-run' }],
      details: {},
    }));
    const tool: AgentTool = {
      name: 'probe_tool',
      label: '探针工具',
      description: '测试用',
      parameters: { type: 'object', properties: {} } as never,
      execute: executeMock as never,
    };

    const events = await runOnce(
      wrapToolWithScopeGuard(tool, guard, {
        logger: { warn: vi.fn(), error: vi.fn() } as never,
        userId: 'admin',
        agentName: '采购助手',
        threadId: 't_1',
      }),
    );

    expect(executeMock).not.toHaveBeenCalled();
    const end = events.find((event) => event.type === 'tool_call_end');
    expect(end).toMatchObject({ type: 'tool_call_end', callId: 'call_1', status: 'error' });
    expect((end as { resultText?: string }).resultText).toContain('未授权给当前用户');
  });

  it('已授权：工具执行，tool_call_end 为 success', async () => {
    const agentDir = tmpAgentDir();
    writeOntology(agentDir, 'admin');
    const guard = createScopeGuard({ agentDir, username: 'admin' });

    const executeMock = vi.fn(async () => ({
      content: [{ type: 'text', text: 'done' }],
      details: {},
    }));
    const tool: AgentTool = {
      name: 'probe_tool',
      label: '探针工具',
      description: '测试用',
      parameters: { type: 'object', properties: {} } as never,
      execute: executeMock as never,
    };

    const events = await runOnce(
      wrapToolWithScopeGuard(tool, guard, {
        logger: { warn: vi.fn(), error: vi.fn() } as never,
        userId: 'admin',
        agentName: '采购助手',
      }),
    );

    expect(executeMock).toHaveBeenCalledTimes(1);
    const end = events.find((event) => event.type === 'tool_call_end');
    expect(end).toMatchObject({ type: 'tool_call_end', callId: 'call_1', status: 'success' });
  });
});

describe('拒绝 → 本轮挂起 → 软收尾（2026-11-09）', () => {
  it('拒绝后模型改调其他工具：该工具零执行，本轮仍产出正文并以 done 结束', async () => {
    const agentDir = tmpAgentDir();
    writeOntology(agentDir, 'zpf'); // probe_tool 只授权给 zpf，admin 会被拒
    const guard = createScopeGuard({ agentDir, username: 'admin' });

    const denied = makeTool('probe_tool');
    const other = makeTool('other_tool');

    const tools = guardTools([denied, other], guard, {
      logger: { warn: vi.fn(), error: vi.fn() } as never,
      userId: 'admin',
      agentName: '采购助手',
      threadId: 't_1',
    });

    const events = await runScript(tools, [
      assistant([{ type: 'toolCall', id: 'c1', name: 'probe_tool', arguments: {} }], 'toolUse'),
      assistant([{ type: 'toolCall', id: 'c2', name: 'other_tool', arguments: {} }], 'toolUse'),
      assistant([{ type: 'text', text: '抱歉，我没有这个操作的权限，已停止。' }], 'stop'),
    ]);

    // 两个工具都零执行：第一个被拒，第二个被"本轮挂起"直接拦下
    expect(denied.executeMock).not.toHaveBeenCalled();
    expect(other.executeMock).not.toHaveBeenCalled();

    const ends = events.filter((event) => event.type === 'tool_call_end') as Array<{
      status: string;
      resultText?: string;
    }>;
    expect(ends).toHaveLength(2);
    expect(ends[0]!.status).toBe('error');
    expect(ends[0]!.resultText).toContain('未授权给当前用户');
    expect(ends[0]!.resultText).toContain('因权限不足停止执行工具');
    expect(ends[1]!.status).toBe('error');
    expect(ends[1]!.resultText).toContain('本轮已停止执行工具');

    // 软收尾：以 done 正常结束，不是 error / ABORTED（模型拿到了第 3 步的收尾文本）
    expect(events.some((event) => event.type === 'done')).toBe(true);
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });
});
