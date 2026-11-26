import { describe, expect, it, vi } from 'vitest';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { OntologyIndex } from '../../src/domain/intent-focus/types.js';
import type { OntologyFacts } from '../../src/domain/plan/normalize.js';
import type { PlanRunRecord } from '../../src/domain/plan/store.js';
import { PLAN_TIMEOUT_MS, REPLAN_MAX_PER_RUN } from '../../src/domain/plan/types.js';
import type { BehaviorLookup } from '../../src/domain/rule-gate/types.js';
import { createPlanOrchestrator, type PlanLogger } from '../../src/infra/plan-orchestrator.js';
import { PlanCallTimeoutError } from '../../src/infra/plan-llm.js';

const REF = {
  ontologyKey: 'scenario-a/ontology-1',
  scenarioName: 'scenario-a',
  ontologyName: 'ontology-1',
  behaviorName: 'QueryInventory',
};

const TOOLS = [
  tool('rawmcp__QueryInventory'),
  tool('rawmcp__CreatePurchaseRecord'),
  tool('read_file'),
];

const ONTOLOGY: OntologyIndex = { byId: new Map(), all: [], warnings: [] };

const FACTS: OntologyFacts = {
  relatedConceptsOf: () => [],
  ontologyKeysOfFunction: () => [],
  queryBehaviorsOf: () => [],
};

function tool(name: string): AgentTool {
  return { name, description: `${name} 描述` } as unknown as AgentTool;
}

function behaviorOf(name: string): BehaviorLookup | null {
  if (name === 'rawmcp__QueryInventory')
    return { toolName: name, command: false, relatedFunctions: [], ref: REF };
  if (name === 'rawmcp__CreatePurchaseRecord') {
    return { toolName: name, command: true, relatedFunctions: [], ref: REF };
  }
  return null;
}

function logger(): PlanLogger & { events: Array<{ event?: unknown; reason?: unknown }> } {
  const events: Array<{ event?: unknown; reason?: unknown }> = [];
  return {
    events,
    info: (fields) => events.push(fields),
    warn: (fields) => events.push(fields),
  };
}

const ONE_STEP = JSON.stringify([
  {
    seqId: 1,
    taskName: '查询库存',
    content: '查询库存',
    coreAction: 'QueryInventory',
    type: 'query',
  },
]);

const COMMAND_STEP = JSON.stringify([
  {
    seqId: 1,
    taskName: '创建采购',
    content: '创建采购',
    coreAction: 'CreatePurchaseRecord',
    type: 'command',
  },
]);

const TWO_STEP = JSON.stringify([
  {
    seqId: 1,
    taskName: '查询库存',
    content: '查询库存',
    coreAction: 'QueryInventory',
    type: 'query',
  },
  {
    seqId: 2,
    taskName: '创建采购',
    content: '创建采购',
    coreAction: 'CreatePurchaseRecord',
    type: 'command',
  },
]);

function scripted(outputs: string[]): { plan: ReturnType<typeof vi.fn>; calls: number } {
  const state = { calls: 0 };
  const plan = vi.fn(async () => {
    state.calls += 1;
    const next = outputs.shift();
    if (next === undefined) throw new Error('桩 LLM 已无脚本输出');
    return next;
  });
  return {
    plan: plan as unknown as ReturnType<typeof vi.fn>,
    get calls() {
      return state.calls;
    },
  } as unknown as { plan: ReturnType<typeof vi.fn>; calls: number };
}

function build(outputs: string[], overrides: Record<string, unknown> = {}) {
  const stub = scripted(outputs);
  const log = logger();
  const suspend = vi.fn<(code: string) => void>();
  const orchestrator = createPlanOrchestrator({
    goal: '补采购',
    userInput: '帮我补齐缺料采购',
    focusPrompt: '［聚焦结果］QueryInventory 可查库存',
    history: [],
    tools: TOOLS,
    ontology: ONTOLOGY,
    facts: FACTS,
    behaviorOf,
    plan: stub.plan as never,
    signal: new AbortController().signal,
    logger: log,
    suspend,
    ...overrides,
  });
  return { orchestrator, plan: stub.plan, log, suspend };
}

interface TurnOptions {
  calls?: Array<{ id: string; name: string; isError?: boolean; code?: string }>;
  text?: string;
}

async function runTurn(
  orchestrator: ReturnType<typeof build>['orchestrator'],
  options: TurnOptions = {},
): Promise<boolean> {
  for (const call of options.calls ?? []) {
    await orchestrator.hooks.afterToolCall({
      toolCall: { id: call.id, name: call.name, arguments: {} },
      isError: call.isError === true,
      result: {
        content: [{ type: 'text', text: call.isError === true ? '失败' : 'ok' }],
        details: call.code === undefined ? {} : { toolError: { code: call.code, message: '失败' } },
      },
      context: { systemPrompt: 'S', messages: [], tools: [] },
    } as never);
  }
  return orchestrator.hooks.shouldStopAfterTurn({
    message: { content: [{ type: 'text', text: options.text ?? '完成' }] },
    toolResults: [],
    context: { systemPrompt: 'S', messages: [], tools: [] },
  } as never);
}

describe('begin', () => {
  it('无可用工具 → 不规划', async () => {
    const { orchestrator, plan, log } = build([], { tools: [] });
    expect(await orchestrator.begin()).toBe(false);
    expect(plan).not.toHaveBeenCalled();
    expect(log.events[0]).toMatchObject({ event: 'plan.skipped', reason: 'no_tools' });
  });

  it('无意图聚焦结果 → 不规划', async () => {
    const { orchestrator, plan, log } = build([], { focusPrompt: '   ' });
    expect(await orchestrator.begin()).toBe(false);
    expect(plan).not.toHaveBeenCalled();
    expect(log.events[0]).toMatchObject({ event: 'plan.skipped', reason: 'empty_focus' });
  });

  it('首次返回 [] → 结束规划并交回主对话（不是失败）', async () => {
    const { orchestrator, suspend } = build(['[]']);
    expect(await orchestrator.begin()).toBe(false);
    expect(orchestrator.finishReason()).toBe('completed');
    expect(suspend).not.toHaveBeenCalled();
  });

  it('规划成功 → 可见工具收窄到 coreAction + 内置，快照进 messages', async () => {
    const { orchestrator } = build([ONE_STEP]);
    expect(await orchestrator.begin()).toBe(true);
    const names = orchestrator.initialTools().map((item) => item.name);
    expect(names).toEqual(['rawmcp__QueryInventory', 'read_file']);

    const messages = orchestrator.initialMessages([{ role: 'user', content: '帮我补齐缺料采购' }]);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toContain('［执行进度］');
    expect(messages[1]?.content).toContain('← 你现在在这一步');
  });

  it('解析失败重试 2 次后放弃，回退既有流程', async () => {
    const { orchestrator, plan, log } = build(['不是 JSON', '不是 JSON', '不是 JSON']);
    expect(await orchestrator.begin()).toBe(false);
    expect(plan).toHaveBeenCalledTimes(3);
    expect(orchestrator.state().planRetryCount).toBe(2);
    expect(orchestrator.finishReason()).toBe('unavailable');
    expect(log.events.some((item) => item.event === 'plan.abandoned')).toBe(true);
  });

  it('规划调用超时 → 直接放弃，不重试（2026-11-26）', async () => {
    const plan = vi.fn(async () => {
      throw new PlanCallTimeoutError(PLAN_TIMEOUT_MS);
    });
    const log = logger();
    const { orchestrator } = build([], { plan, logger: log });

    expect(await orchestrator.begin()).toBe(false);
    // 超时不重试：只调用 1 次，且没有把重试计数抬高
    expect(plan).toHaveBeenCalledTimes(1);
    expect(orchestrator.state().planRetryCount).toBe(0);
    expect(orchestrator.finishReason()).toBe('unavailable');
    expect(log.events).toContainEqual(
      expect.objectContaining({ event: 'plan.abandoned', reason: 'timeout' }),
    );
  });
});

describe('shouldStopAfterTurn', () => {
  it('同 turn 成功不出队，下一 turn 出队后滚动，[] = 完成', async () => {
    const { orchestrator, suspend } = build([ONE_STEP, '[]']);
    expect(await orchestrator.begin()).toBe(true);

    expect(
      await runTurn(orchestrator, { calls: [{ id: 'c1', name: 'rawmcp__QueryInventory' }] }),
    ).toBe(false);
    expect(orchestrator.state().totalSteps).toBe(0);

    expect(await runTurn(orchestrator)).toBe(true);
    expect(orchestrator.state().totalSteps).toBe(1);
    expect(orchestrator.state().rollCount).toBe(1);
    expect(orchestrator.state().replanCount).toBe(0);
    expect(orchestrator.finishReason()).toBe('completed');
    expect(suspend).not.toHaveBeenCalled();
  });

  it('滚动返回新步骤 → 继续执行并切可见工具集', async () => {
    const { orchestrator } = build([ONE_STEP, COMMAND_STEP]);
    expect(await orchestrator.begin()).toBe(true);
    await runTurn(orchestrator, { calls: [{ id: 'c1', name: 'rawmcp__QueryInventory' }] });
    expect(await runTurn(orchestrator)).toBe(false);

    const current = orchestrator.state().current;
    expect(current?.coreAction).toBe('rawmcp__CreatePurchaseRecord');
    const names = orchestrator.initialTools().map((item) => item.name);
    expect(names).toContain('rawmcp__CreatePurchaseRecord');
    expect(names).not.toContain('rawmcp__QueryInventory');
    expect(orchestrator.state().rollCount).toBe(1);
    expect(orchestrator.state().replanCount).toBe(0);
  });

  it('失败重规划达上限 → 终止并软收尾', async () => {
    const { orchestrator, suspend } = build([ONE_STEP]);
    expect(await orchestrator.begin()).toBe(true);
    orchestrator.state().replanCount = REPLAN_MAX_PER_RUN - 1;

    const stopped = await runTurn(orchestrator, {
      calls: [
        { id: 'c1', name: 'rawmcp__QueryInventory', isError: true, code: 'ONTOLOGY_RULE_DENIED' },
      ],
    });
    expect(stopped).toBe(true);
    expect(orchestrator.finishReason()).toBe('replan_exhausted');
    expect(suspend).toHaveBeenCalledTimes(1);
  });

  it('失败未超限 → 触发失败重规划并继续', async () => {
    const { orchestrator } = build([ONE_STEP, TWO_STEP]);
    expect(await orchestrator.begin()).toBe(true);
    const stopped = await runTurn(orchestrator, {
      calls: [
        { id: 'c1', name: 'rawmcp__QueryInventory', isError: true, code: 'ONTOLOGY_RULE_DENIED' },
      ],
    });
    expect(stopped).toBe(false);
    expect(orchestrator.state().replanCount).toBe(1);
    expect(orchestrator.state().current?.seqId).toBe(2);
  });
});

describe('prepareNextTurn', () => {
  it('快照原地替换：重复调用不增加消息数', async () => {
    const { orchestrator } = build([ONE_STEP]);
    expect(await orchestrator.begin()).toBe(true);
    const base = {
      systemPrompt: 'S',
      messages: [
        { role: 'user', content: '帮我补齐缺料采购' },
        { role: 'user', content: '［执行进度］旧快照' },
      ],
      tools: [],
    };
    const first = orchestrator.hooks.prepareNextTurn({ context: base } as never);
    const second = orchestrator.hooks.prepareNextTurn({ context: base } as never);
    expect(first?.context?.messages).toHaveLength(2);
    expect(second?.context?.messages).toHaveLength(2);
    expect(first?.context?.systemPrompt).toBe('S');
  });
});

describe('getFollowUpMessages', () => {
  it('受 idleTurns 上限约束（最多 2 次）', async () => {
    const { orchestrator } = build([ONE_STEP]);
    expect(await orchestrator.begin()).toBe(true);
    expect(await orchestrator.hooks.getFollowUpMessages()).toHaveLength(1);
    expect(await orchestrator.hooks.getFollowUpMessages()).toHaveLength(1);
    expect(await orchestrator.hooks.getFollowUpMessages()).toHaveLength(0);
  });
});

describe('写后失效触发失败重规划', () => {
  const PLAN_TWO = JSON.stringify([
    {
      seqId: 1,
      taskName: '查询库存',
      content: '查询库存',
      coreAction: 'QueryInventory',
      type: 'query',
    },
    {
      seqId: 2,
      taskName: '创建采购',
      content: '创建采购',
      coreAction: 'CreatePurchaseRecord',
      type: 'command',
    },
  ]);

  function staleBehaviorOf(name: string): BehaviorLookup | null {
    if (name === 'rawmcp__QueryInventory') {
      return { toolName: name, command: false, relatedFunctions: [], ref: REF };
    }
    if (name === 'rawmcp__CreatePurchaseRecord') {
      return { toolName: name, command: true, relatedFunctions: ['sumRawNotArrivalQty'], ref: REF };
    }
    return null;
  }

  it('依赖过期：replanCount=1、rollCount=0，重规划输入点明失效', async () => {
    const { orchestrator, plan, log } = build([PLAN_TWO, '[]'], {
      tools: [...TOOLS, tool('rawmcp__sumRawNotArrivalQty')],
      behaviorOf: staleBehaviorOf,
      isStale: (name: string) => name === 'rawmcp__sumRawNotArrivalQty',
    });

    expect(await orchestrator.begin()).toBe(true);
    // 第 2 步确实带上了依赖（前置条件成立，否则用例证明不了失效路径）
    expect(orchestrator.state().queue[0]?.dependTools).toContain('rawmcp__sumRawNotArrivalQty');

    expect(
      await runTurn(orchestrator, { calls: [{ id: 'c1', name: 'rawmcp__QueryInventory' }] }),
    ).toBe(false);
    expect(await runTurn(orchestrator)).toBe(true);

    expect(orchestrator.state().replanCount).toBe(1);
    expect(orchestrator.state().rollCount).toBe(0);
    expect(orchestrator.finishReason()).toBe('completed');
    expect(
      log.events.some(
        (item) => item.event === 'plan.replanned' && item.reason === 'stale_functions',
      ),
    ).toBe(true);
    expect(log.events.some((item) => item.event === 'plan.step.failed')).toBe(false);

    const secondPrompt = (plan.mock.calls[1]?.[0] as { messages: Array<{ content: string }> })
      .messages;
    expect(secondPrompt.at(-1)?.content).toContain('已被上一步写操作失效');
  });

  it('依赖不过期 / 未注入探测器 → 照常推进，不重规划', async () => {
    const noStale = build([PLAN_TWO, '[]'], {
      tools: [...TOOLS, tool('rawmcp__sumRawNotArrivalQty')],
      behaviorOf: staleBehaviorOf,
      isStale: () => false,
    });
    expect(await noStale.orchestrator.begin()).toBe(true);
    await runTurn(noStale.orchestrator, { calls: [{ id: 'c1', name: 'rawmcp__QueryInventory' }] });
    await runTurn(noStale.orchestrator);
    expect(noStale.orchestrator.state().replanCount).toBe(0);
    expect(noStale.orchestrator.state().current?.seqId).toBe(2);

    const noProbe = build([PLAN_TWO, '[]'], {
      tools: [...TOOLS, tool('rawmcp__sumRawNotArrivalQty')],
      behaviorOf: staleBehaviorOf,
    });
    expect(await noProbe.orchestrator.begin()).toBe(true);
    await runTurn(noProbe.orchestrator, { calls: [{ id: 'c1', name: 'rawmcp__QueryInventory' }] });
    await runTurn(noProbe.orchestrator);
    expect(noProbe.orchestrator.state().replanCount).toBe(0);
  });
});

describe('留档回调 record', () => {
  function collector(): { records: PlanRunRecord[]; record: (item: PlanRunRecord) => void } {
    const records: PlanRunRecord[] = [];
    return { records, record: (item) => records.push(item) };
  }

  it('产出过步骤并正常结束 → 回调一次，字段与过程事实一致', async () => {
    const sink = collector();
    const { orchestrator } = build([ONE_STEP, '[]'], { record: sink.record });
    expect(await orchestrator.begin()).toBe(true);
    await runTurn(orchestrator, { calls: [{ id: 'c1', name: 'rawmcp__QueryInventory' }] });
    expect(await runTurn(orchestrator)).toBe(true);

    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({
      goal: '补采购',
      reason: 'completed',
      total_steps: 1,
      rolls: 1,
      replans: 0,
      done_summary: ['查询库存（QueryInventory）已完成'],
    });
    expect(sink.records[0]!.duration_ms).toBeGreaterThanOrEqual(0);
    expect(sink.records[0]!.steps).toEqual([
      {
        seq_id: 1,
        task_name: '查询库存',
        type: 'query',
        core_action: 'rawmcp__QueryInventory',
        status: 'done',
        attempts: 1,
      },
    ]);
  });

  it('非正常结束（重规划超限）也留档，reason 可区分', async () => {
    const sink = collector();
    const { orchestrator } = build([ONE_STEP], { record: sink.record });
    expect(await orchestrator.begin()).toBe(true);
    orchestrator.state().replanCount = REPLAN_MAX_PER_RUN - 1;
    await runTurn(orchestrator, {
      calls: [
        { id: 'c1', name: 'rawmcp__QueryInventory', isError: true, code: 'ONTOLOGY_RULE_DENIED' },
      ],
    });
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]!.reason).toBe('replan_exhausted');
  });

  it('首轮 [] → 不回调（空轮不进留档）', async () => {
    const sink = collector();
    const { orchestrator } = build(['[]'], { record: sink.record });
    expect(await orchestrator.begin()).toBe(false);
    expect(sink.records).toHaveLength(0);
  });

  it('跳过规划 / 规划放弃 → 不回调', async () => {
    const noTools = collector();
    await build([], { tools: [], record: noTools.record }).orchestrator.begin();
    expect(noTools.records).toHaveLength(0);

    const noFocus = collector();
    await build([], { focusPrompt: '', record: noFocus.record }).orchestrator.begin();
    expect(noFocus.records).toHaveLength(0);

    const abandoned = collector();
    const { orchestrator } = build(['不是 JSON', '不是 JSON', '不是 JSON'], {
      record: abandoned.record,
    });
    expect(await orchestrator.begin()).toBe(false);
    expect(abandoned.records).toHaveLength(0);
  });

  it('终止后重复判停不重复回调', async () => {
    const sink = collector();
    const { orchestrator } = build([ONE_STEP, '[]'], { record: sink.record });
    expect(await orchestrator.begin()).toBe(true);
    await runTurn(orchestrator, { calls: [{ id: 'c1', name: 'rawmcp__QueryInventory' }] });
    await runTurn(orchestrator);
    expect(await runTurn(orchestrator)).toBe(true);
    expect(sink.records).toHaveLength(1);
  });

  it('回调自身抛错不影响本轮：只告警', async () => {
    const { orchestrator, log } = build([ONE_STEP, '[]'], {
      record: () => {
        throw new Error('磁盘满了');
      },
    });
    expect(await orchestrator.begin()).toBe(true);
    await runTurn(orchestrator, { calls: [{ id: 'c1', name: 'rawmcp__QueryInventory' }] });
    await expect(runTurn(orchestrator)).resolves.toBe(true);
    expect(orchestrator.finishReason()).toBe('completed');
    expect(log.events.some((item) => item.event === 'plan.record.failed')).toBe(true);
  });

  it('未注入 record → 全过程无副作用', async () => {
    const { orchestrator } = build([ONE_STEP, '[]']);
    expect(await orchestrator.begin()).toBe(true);
    await runTurn(orchestrator, { calls: [{ id: 'c1', name: 'rawmcp__QueryInventory' }] });
    await expect(runTurn(orchestrator)).resolves.toBe(true);
  });
});
