/**
 * 集成测试（进程内）：T402 / T403 —— 缺前置函数 → 补调 → 成功。
 *
 * 验的是「pause 不是 failed」这条口径在真实链路上成立：
 * 1. 工具第一次因缺前置被闸门暂停（`RULE_FUNCTIONS_MISSING_CODE`）；
 * 2. **不触发失败重规划**（`replanCount` 不动），只是 `attempts` 累加；
 * 3. 依赖函数在该步的可见工具集里（否则模型调不到 → 死锁）；
 * 4. 补调后重试同一 command 成功，终态 `done`。
 */
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
        // 先进攻：模型不知道规则，直接创建（闸门暂停）
        if (hop === 0) return call('erp__CreatePurchaseRecord', 'c1');
        // 补调前置函数（若不在可见集，这里会是 Tool not found）
        if (hop === 1) return call('erp__checkStock', 'c2');
        // 再试同一次写入
        if (hop === 2) return call('erp__CreatePurchaseRecord', 'c3');
        return say('采购单已创建');
      },
    });

    const ends = toolEnds(run.events);

    // T403：依赖函数必须在可见集里——调用成功（未报 Tool not found）即证明
    expect(stock.calls()).toBe(1);
    expect(ends.some((end) => end.resultText === 'Tool erp__checkStock not found')).toBe(false);
    expect(ends.map((end) => end.status).slice(0, 3)).toEqual(['error', 'success', 'success']);

    // T402：暂停不推进、不重规划；重试后同一 command 成功
    // 暂停那次闸门直接返回、不进 `execute`，所以真实执行次数是 1（`attempts` 才是 2）
    expect(create.calls()).toBe(1);
    expect(run.state.replanCount).toBe(0);
    expect(run.state.totalSteps).toBe(1);
    // 完成时 attempts 记为 2（一次暂停 + 一次成功）
    const done = run.logs.find((item) => item.event === 'plan.step.done');
    expect(done).toMatchObject({ seq_id: 1, attempts: 2 });

    // 正常收尾，不挂起工具
    expect(run.suspends).toEqual([]);
    expect(run.events.some((event) => event.type === 'error')).toBe(false);
  });
});
