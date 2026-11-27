/**
 * 规划门禁（028）：题面口径与阈值判定。
 *
 * 判定只回答一个问题——"这句话是不是一步就能完成"。
 * 阈值取 0.4（产品口径：宁可多规划、不可漏规划），分数缺失一律放行。
 */
import { describe, expect, it } from 'vitest';

import {
  PLAN_GATE_ID,
  PLAN_GATE_QUESTION,
  planCapabilityBlocks,
  planGateBlocks,
} from '../../src/domain/intent-focus/plan-gate.js';

describe('plan-gate 题面', () => {
  it('题号固定为 plan_gate，类型为 noul，且明确"一步能完成"的判据', () => {
    expect(PLAN_GATE_ID).toBe('plan_gate');
    expect(PLAN_GATE_QUESTION.type).toBe('noul');
    expect(PLAN_GATE_QUESTION.instructions).toContain('一步就能完成');
    expect(PLAN_GATE_QUESTION.criteria?.false).toContain('一轮即可完成');
  });

  it('多对象即多步：同一动作查多个对象也算需要分步（2026-11-28 口径翻转）', () => {
    expect(PLAN_GATE_QUESTION.instructions).toContain('即使动作完全相同');
    expect(PLAN_GATE_QUESTION.instructions).not.toContain('算一个任务');
    expect(PLAN_GATE_QUESTION.criteria?.true).toContain('两个及以上对象');
    expect(PLAN_GATE_QUESTION.criteria?.true).toContain('即使动作相同');
  });
});

describe('planGateBlocks（装配层分流）', () => {
  it('分数低于阈值 → 跳过规划', () => {
    expect(planGateBlocks(0.2, 0.4)).toBe(true);
  });

  it('分数达到阈值 → 走规划', () => {
    expect(planGateBlocks(0.4, 0.4)).toBe(false);
    expect(planGateBlocks(0.9, 0.4)).toBe(false);
  });

  it('阈值没配（门禁关闭）或分数缺席（没判/判失败）→ 不跳过（fail-open）', () => {
    expect(planGateBlocks(0.1, undefined)).toBe(false);
    expect(planGateBlocks(undefined, 0.4)).toBe(false);
    expect(planGateBlocks(Number.NaN, 0.4)).toBe(false);
  });
});

describe('planCapabilityBlocks（聚焦能力前置，2026-11-27）', () => {
  it('显式 false（未命中任何本体行为/函数）→ 跳过规划', () => {
    expect(planCapabilityBlocks(false)).toBe(true);
  });

  it('true 或缺席（未接入该判据的调用方）→ 不阻断', () => {
    expect(planCapabilityBlocks(true)).toBe(false);
    expect(planCapabilityBlocks(undefined)).toBe(false);
  });
});
