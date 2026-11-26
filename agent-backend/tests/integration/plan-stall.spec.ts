import { afterEach, describe, expect, it } from 'vitest';

import { ONTOLOGY_YAML, SECURITIES } from './support/plan-ontology.js';
import { call, cleanupFixtures, countingTool, runPlanned, say } from './support/plan-harness.js';

afterEach(cleanupFixtures);

const PLAN_ONE = JSON.stringify([
  { seqId: 1, taskName: '查询库存', content: '查询库存', coreAction: 'QueryInventory', type: 'query' },
]);

describe('T603 连续无进展', () => {
  it('连续 2 turn 无进展 → 失败重规划（rollCount 不变），返回 [] 即正常收尾', async () => {
    const query = countingTool('erp__QueryInventory', '查询库存', { count: 3 });

    const run = await runPlanned({
      ontologyYaml: ONTOLOGY_YAML,
      securities: SECURITIES,
      tools: [query.tool],
      planOutputs: [PLAN_ONE, '[]'],
      loopTurn: () => say('我先想想'),
      maxHops: 8,
    });

    expect(run.state.replanCount).toBe(1);
    expect(run.state.rollCount).toBe(0);
    expect(run.finish).toBe('completed');
    expect(query.calls()).toBe(0);

    const stalled = run.logs.find((item) => item.event === 'plan.step.stalled');
    expect(stalled).toMatchObject({ seq_id: 1, idle_turns: 2 });

    expect(run.suspends).toEqual([]);
    expect(run.events.some((event) => event.type === 'done')).toBe(true);
    expect(run.events.some((event) => event.type === 'error')).toBe(false);
  });

  it('重规划用尽 → 软收尾（挂起工具）且本轮仍正常 done', async () => {
    const query = countingTool('erp__QueryInventory', '查询库存', { count: 3 });

    const run = await runPlanned({
      ontologyYaml: ONTOLOGY_YAML,
      securities: SECURITIES,
      tools: [query.tool],
      planOutputs: [PLAN_ONE, PLAN_ONE, PLAN_ONE, PLAN_ONE, PLAN_ONE, PLAN_ONE, PLAN_ONE],
      loopTurn: (hop) => call('ghost__nothing', `g${hop}`),
      maxHops: 24,
    });

    expect(run.state.replanCount).toBe(6);
    expect(run.finish).toBe('stalled');
    expect(run.suspends.length).toBeGreaterThan(0);
    expect(run.events.some((event) => event.type === 'done')).toBe(true);
    expect(run.events.some((event) => event.type === 'error')).toBe(false);
  });
});
