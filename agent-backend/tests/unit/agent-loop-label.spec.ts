/**
 * 端到端（进程内）：规划按步收窄工具集后，**工具显示名索引不得跟着收窄**（2026-11-26）。
 *
 * 缺陷复现：`labels` 索引原先只由 `opts.tools` 建立，而 028 计划编排每一跳都会用
 * `prepareNextTurn` 把 `tools` 换成「这一步可见」的子集。于是首步不可见、次步才出现的
 * 工具在索引里查不到 label → `tool_call_start` 不带 label → 前端回退显示
 * `onto_behaviors__QueryInventory` 这类调用名。
 *
 * 判据：`labelTools`（全量装配结果）里有的工具，无论它出现在第几步，事件都必须带人读名。
 */
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { EventStream } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import { runAgentLoopEvents, type RunAgentLoopHooks } from '../../src/infra/agent-loop.js';
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

/** `label` 缺省即"没有中文名"，用于验证"非空才写"口径 */
function tool(name: string, label?: string): AgentTool {
  return {
    name,
    ...(label !== undefined ? { label } : {}),
    description: '测试用',
    parameters: { type: 'object', properties: {} } as never,
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} }) as never,
  };
}

function toolCall(id: string, name: string): AssistantMessage {
  return assistant([{ type: 'toolCall', id, name, arguments: {} }], 'toolUse');
}

const TEXT_ONLY = assistant([{ type: 'text', text: '好的' }], 'stop');

interface DriveOptions {
  script: AssistantMessage[];
  tools: AgentTool[];
  labelTools?: readonly AgentTool[];
  hooks?: RunAgentLoopHooks;
}

async function drive(opts: DriveOptions): Promise<LlmEvent[]> {
  let hop = 0;
  const events: LlmEvent[] = [];
  for await (const event of runAgentLoopEvents({
    model: {} as never,
    streamFn: (() => {
      const message = opts.script[Math.min(hop, opts.script.length - 1)]!;
      hop += 1;
      return fakeStream(message);
    }) as never,
    systemPrompt: 'SYS',
    messages: [{ role: 'user', content: 'hi' }],
    tools: opts.tools,
    ...(opts.labelTools !== undefined ? { labelTools: opts.labelTools } : {}),
    thinking: false,
    signal: new AbortController().signal,
    ...(opts.hooks !== undefined ? { hooks: opts.hooks } : {}),
  })) {
    events.push(event);
  }
  return events;
}

/** 模拟计划编排：第 1 步只见 `step_a`，第 2 步只见 `step_b`（两轮都取全量的子集） */
function planLikeHooks(stepB: AgentTool[]): RunAgentLoopHooks {
  return {
    prepareNextTurn: vi.fn(
      (context: { context: { systemPrompt: string; messages: unknown[] } }) => ({
        context: {
          systemPrompt: context.context.systemPrompt,
          messages: context.context.messages,
          tools: stepB,
        },
      }),
    ) as never,
  };
}

describe('agent-loop 的显示名索引：与可见工具集解耦', () => {
  it('次步才出现的工具仍带人读名（修复前：查不到 label，卡片显示英文调用名）', async () => {
    const stepA = tool('onto_behaviors__QueryRawMaterials', '查询原材料基本信息');
    const stepB = tool('onto_behaviors__QueryInventory', '查询原材料库存信息');

    const events = await drive({
      // 第 1 步调 A，第 2 步调 B，第 3 步收尾
      script: [
        toolCall('call_1', stepA.name),
        toolCall('call_2', stepB.name),
        TEXT_ONLY,
      ],
      tools: [stepA], // 首步收窄集：B 不可见
      labelTools: [stepA, stepB], // 全量装配集
      hooks: planLikeHooks([stepB]),
    });

    const starts = events.filter((event) => event.type === 'tool_call_start');
    expect(starts).toHaveLength(2);
    expect(starts[0]).toMatchObject({ name: stepA.name, label: '查询原材料基本信息' });
    // 核心断言：B 从未进入过 `tools`，但必须在全量索引里命中
    expect(starts[1]).toMatchObject({ name: stepB.name, label: '查询原材料库存信息' });
  });

  it('缺省 labelTools 时回退 tools（非规划路径行为不变）', async () => {
    const only = tool('probe_tool', '探针工具');

    const events = await drive({ script: [toolCall('call_1', only.name), TEXT_ONLY], tools: [only] });

    expect(events.find((event) => event.type === 'tool_call_start')).toMatchObject({
      name: only.name,
      label: '探针工具',
    });
  });

  it('label 为空串或缺失时事件不带该字段（保持"非空才写"口径）', async () => {
    const unnamed = tool('probe_tool');

    const events = await drive({
      script: [toolCall('call_1', unnamed.name), TEXT_ONLY],
      tools: [unnamed],
      labelTools: [unnamed],
    });

    const start = events.find((event) => event.type === 'tool_call_start');
    expect(start).toBeDefined();
    expect(start).not.toHaveProperty('label');
  });
});
