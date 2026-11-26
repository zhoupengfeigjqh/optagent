/**
 * 集成测试（进程内）：T308 —— 首轮规划 → 逐步收窄 → 推进 → 完成不挂起。
 *
 * 这一层验的是**装配后真的跑得动**：编排器给出的 `initialTools` / `initialMessages` /
 * hooks 挂到真实 pi loop 上，工具收窄生效、完成判定与推进顺序正确、
 * 正常完成**不走** `suspendTools`（FR-027 ①）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import { ONTOLOGY_YAML, SECURITIES } from './support/plan-ontology.js';
import { call, cleanupFixtures, countingTool, runPlanned, say } from './support/plan-harness.js';

afterEach(cleanupFixtures);

const PLAN_TWO = JSON.stringify([
  { seqId: 1, taskName: '查询库存', content: '查询库存', coreAction: 'QueryInventory', type: 'query' },
  {
    seqId: 2,
    taskName: '创建采购单',
    content: '创建采购单',
    coreAction: 'CreatePurchaseRecord',
    type: 'command',
  },
]);

describe('T308 首轮规划 → 执行 → 完成', () => {
  it('逐步收窄工具、两步完成、滚动返回 [] 即收尾且不挂起', async () => {
    const query = countingTool('erp__QueryInventory', '查询库存', { count: 3 });
    const stock = countingTool('erp__checkStock', '校验库存', { pass: true });
    const create = countingTool('erp__CreatePurchaseRecord', '创建采购单', { id: 'PO-1' });

    const run = await runPlanned({
      ontologyYaml: ONTOLOGY_YAML,
      securities: SECURITIES,
      tools: [query.tool, stock.tool, create.tool],
      planOutputs: [PLAN_TWO, '[]'],
      loopTurn: (hop) => {
        if (hop === 0) return call('erp__QueryInventory', 'c1');
        if (hop === 1) return say('查到 3 种缺料');
        if (hop === 2) return call('erp__checkStock', 'c2');
        if (hop === 3) return call('erp__CreatePurchaseRecord', 'c3');
        return say('采购单已创建');
      },
    });

    // 首轮只看当前步的 coreAction（第 1 步没有依赖）
    expect(run.initialTools).toEqual(['erp__QueryInventory']);

    // 第 2 步的可见集 = coreAction ∪ dependTools（按内容定位，不绑定跳序）
    const step2 = run.contexts.find((context) =>
      context.tools?.some((item) => item.name === 'erp__CreatePurchaseRecord'),
    );
    expect(step2).toBeDefined();
    expect(step2?.tools?.map((item) => item.name).sort()).toEqual([
      'erp__CreatePurchaseRecord',
      'erp__checkStock',
    ]);

    expect(run.state.totalSteps).toBe(2);
    expect(run.state.rollCount).toBe(1);
    expect(run.state.replanCount).toBe(0);
    expect(run.finish).toBe('completed');

    expect(query.calls()).toBe(1);
    expect(stock.calls()).toBe(1);
    expect(create.calls()).toBe(1);

    // FR-027 ①：正常完成直接收尾，MUST NOT 挂起工具
    expect(run.suspends).toEqual([]);
    expect(run.events.some((event) => event.type === 'error')).toBe(false);
    expect(run.events.some((event) => event.type === 'done')).toBe(true);
    // 每一步都下发过快照（模型随时看得到进度）
    expect(
      run.contexts[0]?.messages?.some((message) => String(message.content).includes('［执行进度］')),
    ).toBe(true);
  });

  it('首次规划返回 [] → 交回主对话，编排器不接管 loop', async () => {
    const query = countingTool('erp__QueryInventory', '查询库存');

    const run = await runPlanned({
      ontologyYaml: ONTOLOGY_YAML,
      securities: SECURITIES,
      tools: [query.tool],
      planOutputs: ['[]'],
      loopTurn: () => say('直接回答'),
      maxHops: 3,
    });

    expect(run.finish).toBe('completed');
    // 规划不接管：不给 initialTools / initialMessages，loop 按原样跑（零额外往返）
    expect(run.initialTools).toEqual([]);
    expect(run.contexts).toEqual([]);
    expect(run.suspends).toEqual([]);
    expect(run.planCalls).toBe(1);
  });
});
