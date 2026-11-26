/**
 * 规划门禁（028）：题面口径与阈值判定。
 *
 * 判定只回答一个问题——"这句话是不是一步就能完成"。
 * 阈值取 0.4（产品口径：宁可多规划、不可漏规划），分数缺失一律放行。
 */
import { describe, expect, it } from 'vitest';

import {
  judgePlanGate,
  PLAN_GATE_ID,
  PLAN_GATE_QUESTION,
  planGateBlocks,
} from '../../src/domain/intent-focus/plan-gate.js';

describe('plan-gate 题面', () => {
  it('题号固定为 plan_gate，类型为 noul，且明确"一步能完成"的判据', () => {
    expect(PLAN_GATE_ID).toBe('plan_gate');
    expect(PLAN_GATE_QUESTION.type).toBe('noul');
    expect(PLAN_GATE_QUESTION.instructions).toContain('一步就能完成');
    expect(PLAN_GATE_QUESTION.instructions).toContain('同一动作查询多个对象');
    expect(PLAN_GATE_QUESTION.criteria?.true).toContain('多个对象或多个任务');
    expect(PLAN_GATE_QUESTION.criteria?.false).toContain('一轮即可完成');
  });
});

describe('judgePlanGate', () => {
  it('分数 >= 阈值放行（边界值 0.4 也放行）', () => {
    expect(judgePlanGate(0.4, 0.4)).toBe(true);
    expect(judgePlanGate(0.9, 0.4)).toBe(true);
  });

  it('分数低于阈值拦截', () => {
    expect(judgePlanGate(0.399, 0.4)).toBe(false);
    expect(judgePlanGate(0, 0.4)).toBe(false);
  });

  it('分数缺失或非法一律放行（fail-open）', () => {
    expect(judgePlanGate(null, 0.4)).toBe(true);
    expect(judgePlanGate(undefined, 0.4)).toBe(true);
    expect(judgePlanGate(Number.NaN, 0.4)).toBe(true);
    expect(judgePlanGate(Number.POSITIVE_INFINITY, 0.4)).toBe(true);
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
