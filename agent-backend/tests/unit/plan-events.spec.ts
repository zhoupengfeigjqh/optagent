/**
 * 观测事件断言（028 T703s）：13 个事件逐个落地 + 敏感字段缺失。
 *
 * 只验「事件名与关键字段」：字段口径以 `data-model.md` §10 为准，
 * 这里不重复抄表，而是保证**每个事件在真实路径上真的会被发出**（漏发比发错更难发现）。
 *
 * 另一条硬约束（FR-031 / NFR-004）：**不得记录用户原话与工具结果正文**。
 */
import { describe, expect, it, vi } from 'vitest';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { OntologyIndex } from '../../src/domain/intent-focus/types.js';
import type { OntologyFacts } from '../../src/domain/plan/normalize.js';
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

const USER_INPUT = '帮我补齐缺料采购';

function tool(name: string): AgentTool {
  return { name, description: `${name} 描述` } as unknown as AgentTool;
}

const TOOLS = [tool('rawmcp__QueryInventory'), tool('rawmcp__CreatePurchaseRecord'), tool('read_file')];

function behaviorOf(name: string): BehaviorLookup | null {
  if (name === 'rawmcp__QueryInventory') return { toolName: name, command: false, relatedFunctions: [], ref: REF };
  if (name === 'rawmcp__CreatePurchaseRecord') {
    return { toolName: name, command: true, relatedFunctions: [], ref: REF };
  }
  return null;
}

type Fields = Record<string, unknown>;

function recorder(): PlanLogger & { events: Fields[] } {
  const events: Fields[] = [];
  return {
    events,
    info: (fields) => events.push(fields),
    warn: (fields) => events.push(fields),
  };
}

const ONE_STEP = JSON.stringify([
  { seqId: 1, taskName: '查询库存', content: '查询库存', coreAction: 'QueryInventory', type: 'query' },
]);
const COMMAND_STEP = JSON.stringify([
  { seqId: 1, taskName: '创建采购', content: '创建采购', coreAction: 'CreatePurchaseRecord', type: 'command' },
]);

function build(outputs: string[], overrides: Fields = {}) {
  const log = recorder();
  let index = 0;
  const plan = vi.fn(async () => {
    const next = outputs[Math.min(index, outputs.length - 1)];
    index += 1;
    return next!;
  });
  const orchestrator = createPlanOrchestrator({
    goal: '补采购',
    userInput: USER_INPUT,
    focusPrompt: '［聚焦结果］QueryInventory 可查库存',
    history: [],
    tools: TOOLS,
    ontology: ONTOLOGY,
    facts: FACTS,
    behaviorOf,
    plan: plan as never,
    signal: new AbortController().signal,
    logger: log,
    suspend: vi.fn(),
    ...overrides,
  } as never);
  return { orchestrator, log };
}

async function turn(
  orchestrator: ReturnType<typeof build>['orchestrator'],
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

describe('028 观测事件（T703s）', () => {
  it('13 个事件在各自的真实路径上都会被发出', async () => {
    const seen = new Set<string>();
    const collect = (events: Fields[]) => {
      for (const fields of events) {
        if (typeof fields.event === 'string') seen.add(fields.event);
      }
    };

    // ① 跳过：无工具 / 无聚焦
    const noTools = build([ONE_STEP], { tools: [] });
    expect(await noTools.orchestrator.begin()).toBe(false);
    collect(noTools.log.events);

    const noFocus = build([ONE_STEP], { focusPrompt: '  ' });
    expect(await noFocus.orchestrator.begin()).toBe(false);
    collect(noFocus.log.events);

    // ② 解析失败 → rejected → abandoned
    const bad = build(['不是 JSON'], {});
    expect(await bad.orchestrator.begin()).toBe(false);
    collect(bad.log.events);

    // ③ 正常链路：requested → parsed → started → step.started → out_of_focus
    //    → step.done → finished(completed)
    const ok = build([ONE_STEP, '[]'], { focusPrompt: '［聚焦结果］其它行为' });
    expect(await ok.orchestrator.begin()).toBe(true);
    await turn(ok.orchestrator, { id: 'c1', name: 'rawmcp__QueryInventory' });
    await turn(ok.orchestrator);
    collect(ok.log.events);

    // ④ 步骤失败 → step.failed → replanned(kind=failure)
    const denied = build([COMMAND_STEP, '[]']);
    expect(await denied.orchestrator.begin()).toBe(true);
    await turn(denied.orchestrator, { id: 'c1', name: 'rawmcp__CreatePurchaseRecord', code: 'ONTOLOGY_RULE_DENIED' });
    collect(denied.log.events);

    // ⑤ 卡死 → step.stalled（再加一次失败重规划）
    const stalled = build([ONE_STEP, '[]']);
    expect(await stalled.orchestrator.begin()).toBe(true);
    await turn(stalled.orchestrator, undefined, '我先想想');
    await turn(stalled.orchestrator, undefined, '我再想想');
    collect(stalled.log.events);

    // ⑥ 滚动：replanned(kind=roll)
    const roll = build([ONE_STEP, ONE_STEP, '[]']);
    expect(await roll.orchestrator.begin()).toBe(true);
    await turn(roll.orchestrator, { id: 'c1', name: 'rawmcp__QueryInventory' });
    await turn(roll.orchestrator);
    collect(roll.log.events);

    const expected = [
      'plan.skipped',
      'plan.rejected',
      'plan.abandoned',
      'plan.requested',
      'plan.parsed',
      'plan.started',
      'plan.step.out_of_focus',
      'plan.step.started',
      'plan.step.done',
      'plan.step.failed',
      'plan.step.stalled',
      'plan.replanned',
      'plan.finished',
    ];
    for (const name of expected) {
      expect(seen.has(name), `事件缺失：${name}（实际：${[...seen].join('、')}）`).toBe(true);
    }
  });

  it('每一步各发一次 plan.step.started，第 2 步能看到收窄后的工具数（2026-11-26）', async () => {
    const twoStep = JSON.stringify([
      { seqId: 1, taskName: '查询库存', content: '查询库存', coreAction: 'QueryInventory', type: 'query' },
      { seqId: 2, taskName: '创建采购', content: '创建采购', coreAction: 'CreatePurchaseRecord', type: 'command' },
    ]);
    const run = build([twoStep, '[]']);
    expect(await run.orchestrator.begin()).toBe(true);
    await turn(run.orchestrator, { id: 'c1', name: 'rawmcp__QueryInventory' });
    await turn(run.orchestrator);

    const started = run.log.events.filter((fields) => fields.event === 'plan.step.started');
    // 批首步由 enqueue 发、同批推进由 shouldStopAfterTurn 补发：两步各一条
    expect(started.map((fields) => fields.seq_id)).toEqual([1, 2]);
    // 本轮共 3 个工具，每步只留「本步 coreAction + 内置」
    expect(started.map((fields) => fields.visible_tool_count)).toEqual([2, 2]);
  });

  it('事件里不含用户原话与工具结果正文', async () => {
    const run = build([COMMAND_STEP, '[]']);
    await run.orchestrator.begin();
    await turn(run.orchestrator, { id: 'c1', name: 'rawmcp__CreatePurchaseRecord', code: 'ONTOLOGY_RULE_DENIED' });

    const serialized = JSON.stringify(run.log.events);
    expect(serialized).not.toContain(USER_INPUT);
    expect(serialized).not.toContain('工具输出正文');
    // 只记标识与计数
    expect(run.log.events.some((fields) => fields.event === 'plan.step.failed')).toBe(true);
  });

  it('skipped 的 reason 覆盖 switch_off / focus_disabled 之外的两种规划内原因', async () => {
    const noTools = build([ONE_STEP], { tools: [] });
    await noTools.orchestrator.begin();
    expect(noTools.log.events[0]).toMatchObject({ event: 'plan.skipped', reason: 'no_tools' });

    const noFocus = build([ONE_STEP], { focusPrompt: '' });
    await noFocus.orchestrator.begin();
    expect(noFocus.log.events[0]).toMatchObject({ event: 'plan.skipped', reason: 'empty_focus' });
  });
});
