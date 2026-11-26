/**
 * 计划进度事件（028 T901s / FR-034）：三处发点各发一次，空轮零发。
 *
 * 这条断言保护的是「聊天区进度条」的唯一数据源：`{ seqId, label, phase }`。
 * 若发点从 `refreshVisible()` 旁边挪走，就会出现"进度跳了但工具集没切"的错位；
 * 若空轮也发，进度条会在"没规划"的轮次凭空出现。
 */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import type { OntologyIndex } from '../../src/domain/intent-focus/types.js';
import type { OntologyFacts } from '../../src/domain/plan/normalize.js';
import type { PlanProgress } from '../../src/domain/plan/types.js';
import type { BehaviorLookup } from '../../src/domain/rule-gate/types.js';
import { createPlanOrchestrator, type PlanLogger } from '../../src/infra/plan-orchestrator.js';

const REF = {
  ontologyKey: 'scenario-a/ontology-1',
  scenarioName: 'scenario-a',
  ontologyName: 'ontology-1',
  behaviorName: 'QueryInventory',
};

const ONTOLOGY: OntologyIndex = { byId: new Map(), all: [], warnings: [] };
const FACTS: OntologyFacts = {
  relatedConceptsOf: () => [],
  ontologyKeysOfFunction: () => [],
  queryBehaviorsOf: () => [],
};

function tool(name: string): AgentTool {
  return { name, description: `${name} 描述` } as unknown as AgentTool;
}

const TOOLS = [
  tool('rawmcp__QueryInventory'),
  tool('rawmcp__CreatePurchaseRecord'),
  tool('read_file'),
];

function behaviorOf(name: string): BehaviorLookup | null {
  if (name === 'rawmcp__QueryInventory') {
    return { toolName: name, command: false, relatedFunctions: [], ref: REF };
  }
  if (name === 'rawmcp__CreatePurchaseRecord') {
    return { toolName: name, command: true, relatedFunctions: [], ref: REF };
  }
  return null;
}

function recorder(): PlanLogger {
  return { info: () => {}, warn: () => {} };
}

const TWO_STEPS = JSON.stringify([
  { seqId: 1, taskName: '查询库存', content: '查询库存', coreAction: 'QueryInventory', type: 'query' },
  {
    seqId: 2,
    taskName: '创建采购',
    content: '创建采购',
    coreAction: 'CreatePurchaseRecord',
    type: 'command',
  },
]);

const ONE_COMMAND = JSON.stringify([
  {
    seqId: 1,
    taskName: '创建采购',
    content: '创建采购',
    coreAction: 'CreatePurchaseRecord',
    type: 'command',
  },
]);

function build(outputs: string[], progress: PlanProgress[]) {
  let index = 0;
  const plan = vi.fn(async () => {
    const next = outputs[Math.min(index, outputs.length - 1)];
    index += 1;
    return next!;
  });
  const orchestrator = createPlanOrchestrator({
    goal: '补采购',
    userInput: '帮我补齐缺料采购',
    focusPrompt: '［聚焦结果］QueryInventory 可查库存',
    history: [],
    tools: TOOLS,
    ontology: ONTOLOGY,
    facts: FACTS,
    behaviorOf,
    plan: plan as never,
    signal: new AbortController().signal,
    logger: recorder(),
    suspend: vi.fn(),
    onProgress: (event: PlanProgress) => progress.push(event),
  } as never);
  return orchestrator;
}

async function turn(
  orchestrator: ReturnType<typeof build>,
  call?: { id: string; name: string; code?: string },
  text = '完成',
): Promise<boolean> {
  if (call !== undefined) {
    await orchestrator.hooks.afterToolCall({
      toolCall: { id: call.id, name: call.name, arguments: {} },
      isError: call.code !== undefined,
      result: {
        content: [{ type: 'text', text: '工具输出正文' }],
        details: call.code === undefined ? {} : { toolError: { code: call.code, message: '拒绝' } },
      },
      context: { systemPrompt: 'S', messages: [], tools: [] },
    } as never);
  }
  return orchestrator.hooks.shouldStopAfterTurn({
    message: { content: [{ type: 'text', text }] },
    toolResults: [],
    context: { systemPrompt: 'S', messages: [], tools: [] },
  } as never);
}

describe('028 计划进度事件（FR-034）', () => {
  it('装批 running → 步推进 running → 收尾 done，顺序与步号一致', async () => {
    const progress: PlanProgress[] = [];
    const orchestrator = build([TWO_STEPS, '[]'], progress);

    expect(await orchestrator.begin()).toBe(true);
    // 首步在 begin() 内就发出（此时 loop 还没启动）
    expect(progress).toEqual([{ seqId: 1, label: '查询库存', phase: 'running' }]);

    // 第 1 步：调用 coreAction 后，下一个 turn 判定完成 → 推进到第 2 步
    await turn(orchestrator, { id: 'c1', name: 'rawmcp__QueryInventory' });
    await turn(orchestrator);
    expect(progress.at(-1)).toEqual({ seqId: 2, label: '创建采购', phase: 'running' });

    // 第 2 步同样两跳；完成后队列耗尽 → 滚动规划返回 [] → 收尾
    await turn(orchestrator, { id: 'c2', name: 'rawmcp__CreatePurchaseRecord' });
    await turn(orchestrator);

    expect(progress.map((item) => item.phase)).toEqual(['running', 'running', 'done']);
    // `done` 只发一次，且归属最后一步
    expect(progress.filter((item) => item.phase === 'done')).toHaveLength(1);
    expect(progress.at(-1)).toMatchObject({ seqId: 2, phase: 'done' });
  });

  it('失败重规划装批发 replanned（编号跟随新批）', async () => {
    const progress: PlanProgress[] = [];
    // 第 1 批 command 被规则闸门拒绝 → 重规划返回同一 command（重新编号为 1）
    const orchestrator = build([ONE_COMMAND, ONE_COMMAND, '[]'], progress);

    expect(await orchestrator.begin()).toBe(true);
    await turn(orchestrator, {
      id: 'c1',
      name: 'rawmcp__CreatePurchaseRecord',
      code: 'ONTOLOGY_RULE_DENIED',
    });

    const replanned = progress.filter((item) => item.phase === 'replanned');
    expect(replanned).toHaveLength(1);
    expect(replanned[0]).toMatchObject({ label: '创建采购' });
  });

  it('空轮（首轮 [] / 无工具 / 无聚焦）零发：进度条不会凭空出现', async () => {
    const empty: PlanProgress[] = [];
    expect(await build(['[]'], empty).begin()).toBe(false);
    expect(empty).toHaveLength(0);

    const noFocus: PlanProgress[] = [];
    const orchestrator = createPlanOrchestrator({
      goal: 'g',
      userInput: 'u',
      focusPrompt: '   ',
      history: [],
      tools: TOOLS,
      ontology: ONTOLOGY,
      facts: FACTS,
      behaviorOf,
      plan: (async () => TWO_STEPS) as never,
      signal: new AbortController().signal,
      logger: recorder(),
      suspend: vi.fn(),
      onProgress: (event: PlanProgress) => noFocus.push(event),
    } as never);
    expect(await orchestrator.begin()).toBe(false);
    expect(noFocus).toHaveLength(0);
  });

  it('进度只带步名，不带计划正文与工具结果', async () => {
    const progress: PlanProgress[] = [];
    const orchestrator = build([TWO_STEPS, '[]'], progress);
    await orchestrator.begin();
    await turn(orchestrator, { id: 'c1', name: 'rawmcp__QueryInventory' });

    const serialized = JSON.stringify(progress);
    expect(serialized).not.toContain('工具输出正文');
    expect(serialized).not.toContain('帮我补齐缺料采购');
    // 字段收敛为三个键，避免后续顺手加字段破坏契约
    for (const item of progress) {
      expect(Object.keys(item).sort()).toEqual(['label', 'phase', 'seqId']);
    }
  });
});
