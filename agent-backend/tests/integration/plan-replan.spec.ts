/**
 * 集成测试（进程内）：T504 —— 两个连续 command 触发一次写后失效重规划。
 *
 * 形态（spec 用户故事 3）：第一批 `[commandA, commandB]`（**两个不同 command**，
 * 同 command 会被 C4 拒），commandA 执行后闸门让所有函数记录失效，
 * 推进入 commandB 时识别到前置已过期 → 失败重规划 → 第二批 `[function, command]`。
 *
 * 判据：`replanCount === 1` 且**重规划发生时** `rollCount` 仍为 0（滚动是最后才发生的，
 * 看终值会被误读）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import { ONTOLOGY_YAML, SECURITIES } from './support/plan-ontology.js';
import { call, cleanupFixtures, countingTool, runPlanned, say } from './support/plan-harness.js';

afterEach(cleanupFixtures);

const PLAN_TWO_COMMANDS = JSON.stringify([
  {
    seqId: 1,
    taskName: '创建采购单',
    content: '创建采购单',
    coreAction: 'CreatePurchaseRecord',
    type: 'command',
  },
  {
    seqId: 2,
    taskName: '提交审批',
    content: '提交审批',
    coreAction: 'SubmitPurchase',
    type: 'command',
  },
]);

const PLAN_AFTER_STALE = JSON.stringify([
  {
    seqId: 3,
    taskName: '重算可用库存',
    content: '重算可用库存',
    coreAction: 'checkStock',
    type: 'function',
  },
  {
    seqId: 4,
    taskName: '提交审批',
    content: '提交审批',
    coreAction: 'SubmitPurchase',
    type: 'command',
  },
]);

describe('T504 两个连续 command → 写后失效重规划', () => {
  it('第二批插在重算之后，replanCount=1 且重规划时 rollCount=0', async () => {
    const stock = countingTool('erp__checkStock', '校验库存', { pass: true });
    const create = countingTool('erp__CreatePurchaseRecord', '创建采购单', { id: 'PO-1' });
    const submit = countingTool('erp__SubmitPurchase', '提交审批', { ok: true });

    const run = await runPlanned({
      ontologyYaml: ONTOLOGY_YAML,
      securities: SECURITIES,
      tools: [stock.tool, create.tool, submit.tool],
      planOutputs: [PLAN_TWO_COMMANDS, PLAN_AFTER_STALE, '[]'],
      loopTurn: (hop) => {
        if (hop === 0) return call('erp__checkStock', 'c1');
        if (hop === 1) return call('erp__CreatePurchaseRecord', 'c2');
        if (hop === 2) return say('采购单已创建');
        // 重规划后：先重算（第 3 步），确认完成后才提交（第 4 步）
        if (hop === 3) return call('erp__checkStock', 'c3');
        if (hop === 4) return say('可用库存已重算');
        if (hop === 5) return call('erp__SubmitPurchase', 'c4');
        return say('审批已提交');
      },
    });

    expect(run.state.replanCount).toBe(1);
    expect(run.finish).toBe('completed');

    // 重规划发生在推进到 commandB 的那一刻——那时还没发生任何滚动
    const replanned = run.logs.find((item) => item.event === 'plan.replanned');
    expect(replanned).toMatchObject({ kind: 'failure', reason: 'stale_functions' });
    expect((replanned?._state as { roll: number } | undefined)?.roll).toBe(0);

    // 重规划输入点明「已被写操作失效」，而不是笼统的“失败”
    expect(run.planMessages[1]).toContain('已被上一步写操作失效');

    // 三个执行步（create / 重算 / submit），最后靠滚动 [] 收尾
    expect(run.state.totalSteps).toBe(3);
    expect(stock.calls()).toBe(2);
    expect(create.calls()).toBe(1);
    expect(submit.calls()).toBe(1);
    expect(run.state.rollCount).toBe(1);

    expect(run.suspends).toEqual([]);
    expect(run.events.some((event) => event.type === 'error')).toBe(false);
  });
});
