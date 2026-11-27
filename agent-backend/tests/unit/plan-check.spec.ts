/**
 * 单元测试：计划硬校验 C0~C5（028 FR-012）。
 *
 * 守住的口径：
 * - 只判定不改数据；多失败项同时返回；
 * - C4 只拒**重复的 command**，query / function 批内重复合法；
 * - **空批次合法**（FR-004a），不判步数下限；
 * - 字数按字符计（中文算 1）。
 */
import { describe, expect, it } from 'vitest';

import { checkPlan, charLength } from '../../src/domain/plan/check.js';
import type { PlanStep, StepType } from '../../src/domain/plan/types.js';

const AVAILABLE = new Set([
  'rawmcp__queryinventory',
  'queryinventory',
  'rawmcp__createpurchaserecord',
  'createpurchaserecord',
  'rawmcp__sumrawnotarrivalqty',
  'sumrawnotarrivalqty',
]);

const ROLE = (toolName: string): { command: boolean } | null => {
  if (toolName === 'rawmcp__CreatePurchaseRecord') return { command: true };
  if (toolName === 'rawmcp__QueryInventory') return { command: false };
  return null;
};

function step(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    seqId: 1,
    taskName: '查询库存',
    content: '调用 QueryInventory',
    coreActionLabel: 'QueryInventory',
    coreAction: 'rawmcp__QueryInventory',
    type: 'query',
    dependTools: [],
    status: 'pending',
    coreActionOk: false,
    attempts: 0,
    lastCoreActionTurn: -1,
    retryableStreak: 0,
    ...overrides,
  };
}

function check(steps: PlanStep[], preFailures = []) {
  return checkPlan({ steps, available: AVAILABLE, behaviorOf: ROLE, preFailures });
}

describe('checkPlan', () => {
  it('合法计划通过', () => {
    expect(check([step()]).ok).toBe(true);
  });

  it('空批次合法（0 步不判越界）', () => {
    expect(check([]).ok).toBe(true);
  });

  it('C0：coreAction 不在可用工具中', () => {
    const result = check([step({ coreAction: 'rawmcp__Missing', coreActionLabel: 'Missing' })]);
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.code === 'C0')).toBe(true);
  });

  it('C1：type 非法', () => {
    const result = check([step({ type: 'write' as StepType })]);
    expect(result.failures.some((failure) => failure.code === 'C1')).toBe(true);
  });

  it('C2：type 与本体角色不符', () => {
    const result = check([
      step({
        coreAction: 'rawmcp__CreatePurchaseRecord',
        coreActionLabel: 'CreatePurchaseRecord',
        type: 'query',
      }),
    ]);
    expect(result.failures.some((failure) => failure.code === 'C2')).toBe(true);
  });

  it('C3：dependTools 含不可用工具', () => {
    const result = check([
      step({
        coreAction: 'rawmcp__CreatePurchaseRecord',
        coreActionLabel: 'CreatePurchaseRecord',
        type: 'command',
        dependTools: ['rawmcp__NotMounted'],
      }),
    ]);
    expect(result.failures.some((failure) => failure.code === 'C3')).toBe(true);
  });

  it('C4：同一 command 占两步被拒', () => {
    const result = check([
      step({ seqId: 1, coreAction: 'rawmcp__CreatePurchaseRecord', coreActionLabel: 'CreatePurchaseRecord', type: 'command' }),
      step({ seqId: 2, coreAction: 'rawmcp__CreatePurchaseRecord', coreActionLabel: 'CreatePurchaseRecord', type: 'command' }),
    ]);
    expect(result.failures.some((failure) => failure.code === 'C4')).toBe(true);
  });

  it('C4：query 批内重复通过', () => {
    const result = check([step({ seqId: 1 }), step({ seqId: 2 })]);
    expect(result.ok).toBe(true);
  });

  it('C5：超过 3 步', () => {
    const result = check([step({ seqId: 1 }), step({ seqId: 2 }), step({ seqId: 3 }), step({ seqId: 4 })]);
    expect(result.failures.some((failure) => failure.code === 'C5')).toBe(true);
  });

  it('C5：taskName 超 20 字 / content 超 300 字', () => {
    const result = check([step({ taskName: '字'.repeat(21), content: '字'.repeat(301) })]);
    const fields = result.failures.filter((failure) => failure.code === 'C5').map((failure) => failure.field);
    expect(fields).toContain('taskName');
    expect(fields).toContain('content');
  });

  it('归一化预检失败会并入结果', () => {
    const result = check([step()], [
      { code: 'C0', seqId: 2, field: 'coreAction', detail: '预检失败' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
  });
});

describe('charLength', () => {
  it('中文与代理对都算 1', () => {
    expect(charLength('原材料')).toBe(3);
    expect(charLength('a😀')).toBe(2);
  });
});
