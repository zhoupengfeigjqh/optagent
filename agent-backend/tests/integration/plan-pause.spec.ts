import { afterEach, describe, expect, it } from 'vitest';

import { ONTOLOGY_YAML, SECURITIES } from './support/plan-ontology.js';
import { call, cleanupFixtures, countingTool, runPlanned, say, toolEnds } from './support/plan-harness.js';

afterEach(cleanupFixtures);

const PLAN_COMMAND = JSON.stringify([
  {
    seqId: 1,
    taskName: '创建采购单',
    content: '创建采购单',
    coreAction: 'CreatePurchaseRecord',
    type: 'command',
  },
]);

describe('T402/T403 缺前置函数 → 补调 → 成功', () => {
  it('首次暂停不重规划，补调依赖后重试成功', async () => {
    const stock = countingTool('erp__checkStock', '校验库存', { pass: true });
    const create = countingTool('erp__CreatePurchaseRecord', '创建采购单', { id: 'PO-1' });

    const run = await runPlanned({
      ontologyYaml: ONTOLOGY_YAML,
      securities: SECURITIES,
      tools: [stock.tool, create.tool],
      planOutputs: [PLAN_COMMAND, '[]'],
      loopTurn: (hop) => {
        if (hop === 0) return call('erp__CreatePurchaseRecord', 'c1');
        if (hop === 1) return call('erp__checkStock', 'c2');
        if (hop === 2) return call('erp__CreatePurchaseRecord', 'c3');
        return say('采购单已创建');
      },
    });

    const ends = toolEnds(run.events);

    // T403：依赖函数必须在可见集里——调用成功（未报 Tool not found）即证明
    expect(stock.calls()).toBe(1);
    expect(ends.some((end) => end.resultText === 'Tool erp__checkStock not found')).toBe(false);
    expect(ends.map((end) => end.status).slice(0, 3)).toEqual(['error', 'success', 'success']);

    expect(create.calls()).toBe(1);
    expect(run.state.replanCount).toBe(0);
    expect(run.state.totalSteps).toBe(1);
    const done = run.logs.find((item) => item.event === 'plan.step.done');
    expect(done).toMatchObject({ seq_id: 1, attempts: 2 });

    expect(run.suspends).toEqual([]);
    expect(run.events.some((event) => event.type === 'error')).toBe(false);
  });
});
