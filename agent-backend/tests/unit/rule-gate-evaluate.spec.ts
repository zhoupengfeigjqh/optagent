/**
 * 单元测试：规则求值（021）。
 *
 * 守住的口径：
 * - 组内 `and` / `or` × 组间 `and` / `or`（根 `combine`）两级合成；
 * - **不短路**：失败条件全部收集，最多 10 条；
 * - 多条规则合成：任一 `false` 即整体 `false`，`design=null` 不阻断；
 * - 函数未记录 / 字段缺失 / 记录值为 `null` → 该条件不成立；
 * - `invalid` 条件恒不成立；空组与非法条件不崩。
 */
import { describe, expect, it } from 'vitest';

import { normalizeDesign } from '../../src/domain/rule-gate/design.js';
import { evaluateDesign, evaluateRules, MAX_FAILED_CONDITIONS } from '../../src/domain/rule-gate/evaluate.js';
import type { EvaluateContext, RuleDesign, RuleSpec } from '../../src/domain/rule-gate/types.js';

function designOf(raw: unknown): RuleDesign {
  const design = normalizeDesign(raw, []);
  if (design === null) throw new Error('fixture design is invalid');
  return design;
}

/** 记录 fixture：键存在即已执行；`null` 视为取不到值 */
function contextOf(values: Record<string, unknown>): EvaluateContext {
  return {
    resultOf(functionName) {
      if (!Object.prototype.hasOwnProperty.call(values, functionName)) {
        return { found: false, value: undefined };
      }
      const value = values[functionName];
      if (value === null || value === undefined) return { found: false, value: undefined };
      return { found: true, value };
    },
    declaredTypeOf(functionName, field) {
      const response = values[`${functionName}:response`];
      if (typeof response !== 'object' || response === null) return undefined;
      const declared = (response as Record<string, unknown>)[field];
      return declared === 'boolean' || declared === 'integer' || declared === 'number' || declared === 'string'
        ? declared
        : undefined;
    },
  };
}

function condition(fn: string, field: string, operator: string, values: string[] = []) {
  return { function: fn, field, operator, values };
}

function ruleOf(design: RuleDesign | null, name = 'R1'): RuleSpec {
  return {
    name,
    title: '',
    description: '',
    behavior: 'B',
    position: '前置',
    relatedFunctions: [],
    dataSupplements: [],
    design,
    passMessage: '',
    failMessage: '',
    raw: {},
  };
}

describe('evaluateDesign：两级合成', () => {
  it('组内 and：全部成立才成立', () => {
    const design = designOf({
      groups: [{ combine: 'and', conditions: [condition('f', 'a', 'eq', ['1']), condition('f', 'b', 'eq', ['2'])] }],
    });
    const ctx = contextOf({ f: { a: '1', b: '2' } });
    expect(evaluateDesign(design, ctx, 'R1').passed).toBe(true);

    const bad = contextOf({ f: { a: '1', b: '3' } });
    const outcome = evaluateDesign(design, bad, 'R1');
    expect(outcome.passed).toBe(false);
    expect(outcome.failed).toHaveLength(1);
  });

  it('组内 or：任一成立即成立', () => {
    const design = designOf({
      groups: [{ combine: 'or', conditions: [condition('f', 'a', 'eq', ['1']), condition('f', 'b', 'eq', ['2'])] }],
    });
    expect(evaluateDesign(design, contextOf({ f: { a: 'x', b: '2' } }), 'R1').passed).toBe(true);
    expect(evaluateDesign(design, contextOf({ f: { a: 'x', b: 'y' } }), 'R1').passed).toBe(false);
  });

  it('组间 and / or：由根 combine 决定', () => {
    const groups = [
      { combine: 'and', conditions: [condition('f', 'a', 'eq', ['1'])] },
      { combine: 'and', conditions: [condition('f', 'b', 'eq', ['2'])] },
    ];
    const ctx = contextOf({ f: { a: '1', b: 'x' } });

    expect(evaluateDesign(designOf({ combine: 'and', groups }), ctx, 'R1').passed).toBe(false);
    expect(evaluateDesign(designOf({ combine: 'or', groups }), ctx, 'R1').passed).toBe(true);
  });

  it('三组以上仍由根 combine 合成', () => {
    const groups = [1, 2, 3, 4].map((i) => ({
      combine: 'and',
      conditions: [condition('f', `c${i}`, 'eq', ['ok'])],
    }));
    const ctx = contextOf({ f: { c1: 'ok', c2: 'ok', c3: 'ok', c4: 'no' } });

    expect(evaluateDesign(designOf({ combine: 'or', groups }), ctx, 'R1').passed).toBe(true);
    expect(evaluateDesign(designOf({ combine: 'and', groups }), ctx, 'R1').passed).toBe(false);
  });

  it('不短路：所有失败条件都被收集', () => {
    const design = designOf({
      combine: 'and',
      groups: [
        {
          combine: 'and',
          conditions: [
            condition('f', 'a', 'eq', ['1']),
            condition('f', 'b', 'eq', ['1']),
            condition('f', 'c', 'eq', ['1']),
          ],
        },
      ],
    });
    const outcome = evaluateDesign(design, contextOf({ f: { a: 'x', b: 'x', c: 'x' } }), 'R1');
    expect(outcome.passed).toBe(false);
    expect(outcome.failed.map((item) => item.field)).toEqual(['a', 'b', 'c']);
  });

  it('失败条件上限 10 条', () => {
    const conditions = Array.from({ length: 15 }, (_, i) => condition('f', `c${i}`, 'eq', ['1']));
    const design = designOf({ groups: [{ conditions }] });
    const values: Record<string, unknown> = {};
    for (let i = 0; i < 15; i += 1) values[`c${i}`] = 'x';

    const outcome = evaluateDesign(design, contextOf({ f: values }), 'R1');
    expect(outcome.passed).toBe(false);
    expect(outcome.failed).toHaveLength(MAX_FAILED_CONDITIONS);
  });

  it('记录值为 null / 函数未记录 / 字段缺失 → 条件不成立', () => {
    const design = designOf({
      groups: [
        {
          conditions: [
            condition('nullFn', 'pass', 'eq', ['true']),
            condition('missingFn', 'pass', 'eq', ['true']),
            condition('f', 'absent', 'eq', ['true']),
          ],
        },
      ],
    });
    const outcome = evaluateDesign(
      design,
      contextOf({ nullFn: null, f: { present: true } }),
      'R1',
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failed).toHaveLength(3);
  });

  it('invalid 条件恒不成立，但同组 or 的其它分支仍可成立', () => {
    const design = designOf({
      groups: [
        {
          combine: 'or',
          conditions: [
            { field: 'x', operator: 'eq', values: ['1'] },
            condition('f', 'a', 'eq', ['1']),
          ],
        },
      ],
    });
    expect(evaluateDesign(design, contextOf({ f: { a: '1' } }), 'R1').passed).toBe(true);
    expect(evaluateDesign(design, contextOf({ f: { a: 'x' } }), 'R1').passed).toBe(false);
  });

  it('声明类型参与强制：boolean 字段与字符串 values', () => {
    const design = designOf({
      groups: [{ conditions: [condition('f', 'pass', 'eq', ['true'])] }],
    });
    const ctx = contextOf({ f: { pass: true }, 'f:response': { pass: 'boolean' } });
    expect(evaluateDesign(design, ctx, 'R1').passed).toBe(true);
  });
});

describe('evaluateRules：多规则合成', () => {
  it('任一规则 false 即整体 false；design=null 不阻断', () => {
    const pass = designOf({ groups: [{ conditions: [condition('f', 'a', 'eq', ['1'])] }] });
    const fail = designOf({ groups: [{ conditions: [condition('f', 'b', 'eq', ['1'])] }] });
    const ctx = contextOf({ f: { a: '1', b: 'x' } });

    expect(evaluateRules([ruleOf(pass, 'P'), ruleOf(null, 'N')], ctx).passed).toBe(true);

    const outcome = evaluateRules([ruleOf(pass, 'P'), ruleOf(fail, 'F')], ctx);
    expect(outcome.passed).toBe(false);
    expect(outcome.failed.map((item) => item.rule)).toEqual(['F']);
  });

  it('全部为 null 设计 → 通过且无失败条件', () => {
    const outcome = evaluateRules([ruleOf(null, 'A'), ruleOf(null, 'B')], contextOf({}));
    expect(outcome).toEqual({ passed: true, failed: [] });
  });
});
