/**
 * 集成测试（进程内）：T603 —— 模型空转（连续无进展）触发失败重规划。
 *
 * 判据（FR-028 / FR-027④）：
 * - 指纹（`seqId:coreActionOk:attempts`）连续 2 turn 不变 → `stalled`；
 * - `stalled` **先尝试一次失败重规划**（`replanCount += 1`，`rollCount` 不变）；
 * - 重规划次数用尽后 → 软收尾（`suspendTools`）且本轮正常 `done`，**不产生 error 事件**。
 */
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
      // 模型始终只说话、不动手
      loopTurn: () => say('我先想想'),
      maxHops: 8,
    });

    expect(run.state.replanCount).toBe(1);
    expect(run.state.rollCount).toBe(0);
    expect(run.finish).toBe('completed');
    expect(query.calls()).toBe(0);

    const stalled = run.logs.find((item) => item.event === 'plan.step.stalled');
    expect(stalled).toMatchObject({ seq_id: 1, idle_turns: 2 });

    // 卡死走的是失败重规划，不是直接终止
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
      // 首轮 + 6 次重规划都拿回同一步（模型坚持不改），直到次数用尽
      planOutputs: [PLAN_ONE, PLAN_ONE, PLAN_ONE, PLAN_ONE, PLAN_ONE, PLAN_ONE, PLAN_ONE],
      /**
       * 每跳都调一个不存在的工具：既不改指纹（不是 coreAction，`attempts` 不动），
       * 又让 loop 不因「无工具调用」提前退出——这样 6 次重规划才走得完。
       */
      loopTurn: (hop) => call('ghost__nothing', `g${hop}`),
      maxHops: 24,
    });

    expect(run.state.replanCount).toBe(6);
    expect(run.finish).toBe('stalled');
    // 软收尾：挂起工具，但没有致命中止
    expect(run.suspends.length).toBeGreaterThan(0);
    expect(run.events.some((event) => event.type === 'done')).toBe(true);
    expect(run.events.some((event) => event.type === 'error')).toBe(false);
  });
});
