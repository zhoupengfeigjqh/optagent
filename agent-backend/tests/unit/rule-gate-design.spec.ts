/**
 * 单元测试：`rule_design` 读侧归一（021）。
 *
 * 守住的口径：
 * - 算子全集恰为 16 个，取值个数按算子定；
 * - `combine` 非法一律按 `and`；`groups` 非数组/为空 → 视为未设计（`null`）；
 * - 组内 `conditions` 非数组或为空 → 该组剔除；条件非对象 → 丢弃；
 * - 未知算子、缺 `function` / `field` → 保留但标 `invalid`（恒不成立）；
 * - `values` 非数组单值包裹、元素统一 `String()`；
 * - 组数 / 条数超 5 **不拒绝**（设计期约束，运行期照常求值）。
 */
import { describe, expect, it } from 'vitest';

import {
  isOperatorCode,
  normalizeDesign,
  OPERATOR_CODES,
  valueCountOf,
} from '../../src/domain/rule-gate/design.js';

describe('OPERATOR_CODES / valueCountOf / isOperatorCode', () => {
  it('算子全集恰为 16 个且顺序稳定', () => {
    expect(OPERATOR_CODES).toEqual([
      'eq',
      'ne',
      'gt',
      'gte',
      'lt',
      'lte',
      'between',
      'contains',
      'not_contains',
      'starts_with',
      'ends_with',
      'matches',
      'in',
      'not_in',
      'empty',
      'not_empty',
    ]);
  });

  it('取值个数：empty/not_empty 0、between 2、in/not_in 至少 1、其余 1', () => {
    expect(valueCountOf('empty')).toBe(0);
    expect(valueCountOf('not_empty')).toBe(0);
    expect(valueCountOf('between')).toBe(2);
    expect(valueCountOf('in')).toBe(-1);
    expect(valueCountOf('not_in')).toBe(-1);
    expect(valueCountOf('eq')).toBe(1);
    expect(valueCountOf('matches')).toBe(1);
  });

  it('isOperatorCode 大小写敏感、非字符串一律 false', () => {
    expect(isOperatorCode('eq')).toBe(true);
    expect(isOperatorCode('EQ')).toBe(false);
    expect(isOperatorCode('equals')).toBe(false);
    expect(isOperatorCode(undefined)).toBe(false);
    expect(isOperatorCode(1)).toBe(false);
  });
});

describe('normalizeDesign', () => {
  const validDesign = {
    combine: 'or',
    groups: [
      {
        combine: 'and',
        conditions: [
          { function: 'checkSupplierExistence', field: 'pass', operator: 'eq', values: ['true'] },
        ],
      },
    ],
  };

  it('正常设计：combine 与组内 combine 原样保留', () => {
    const warnings: string[] = [];
    const design = normalizeDesign(validDesign, warnings);
    expect(design).toMatchObject({ combine: 'or' });
    expect(design!.groups[0]!.combine).toBe('and');
    expect(design!.groups[0]!.conditions[0]).toEqual({
      function: 'checkSupplierExistence',
      field: 'pass',
      operator: 'eq',
      values: ['true'],
    });
    expect(warnings).toEqual([]);
  });

  it('combine 非法 → and（根与组同口径）', () => {
    const warnings: string[] = [];
    const design = normalizeDesign(
      {
        combine: 'xor',
        groups: [{ combine: 'XOR', conditions: [{ function: 'f', field: 'x', operator: 'eq', values: 'v' }] }],
      },
      warnings,
    );
    expect(design!.combine).toBe('and');
    expect(design!.groups[0]!.combine).toBe('and');
  });

  it('groups 非数组或为空 → null', () => {
    const a: string[] = [];
    expect(normalizeDesign({ groups: { conditions: [] } }, a)).toBeNull();
    expect(a.join('\n')).toContain('rule_design_no_groups');

    const b: string[] = [];
    expect(normalizeDesign({ groups: [] }, b)).toBeNull();
    expect(b.join('\n')).toContain('rule_design_no_groups');
  });

  it('非对象设计 → null 并告警', () => {
    const warnings: string[] = [];
    expect(normalizeDesign('not-an-object', warnings)).toBeNull();
    expect(warnings).toContain('rule_design_not_object');
  });

  it('组内 conditions 非数组或为空 → 该组剔除；全部剔除则整段 null', () => {
    const warnings: string[] = [];
    const design = normalizeDesign(
      {
        groups: [
          { conditions: 'oops' },
          { conditions: [] },
          { conditions: [{ function: 'f', field: 'x', operator: 'eq', values: ['1'] }] },
        ],
      },
      warnings,
    );
    expect(design!.groups).toHaveLength(1);
    expect(warnings.join('\n')).toContain('rule_design_group_no_conditions');

    const emptyWarnings: string[] = [];
    expect(normalizeDesign({ groups: [{ conditions: [] }] }, emptyWarnings)).toBeNull();
    expect(emptyWarnings.join('\n')).toContain('rule_design_no_valid_groups');
  });

  it('values 非数组 → 单值包裹 + String()；缺省为空数组', () => {
    const warnings: string[] = [];
    const design = normalizeDesign(
      {
        groups: [
          {
            conditions: [
              { function: 'f', field: 'a', operator: 'eq', values: 42 },
              { function: 'f', field: 'b', operator: 'empty' },
              { function: 'f', field: 'c', operator: 'in', values: [1, true, null] },
            ],
          },
        ],
      },
      warnings,
    );
    const conditions = design!.groups[0]!.conditions;
    expect(conditions[0]!.values).toEqual(['42']);
    expect(conditions[1]!.values).toEqual([]);
    expect(conditions[2]!.values).toEqual(['1', 'true', 'null']);
  });

  it('未知算子 → 条件保留但 invalid；原算子进告警', () => {
    const warnings: string[] = [];
    const design = normalizeDesign(
      { groups: [{ conditions: [{ function: 'f', field: 'x', operator: 'like', values: ['a'] }] }] },
      warnings,
    );
    expect(design!.groups[0]!.conditions[0]).toMatchObject({ operator: 'eq', invalid: true });
    expect(warnings.join('\n')).toContain('rule_condition_unknown_operator:like');
  });

  it('缺 function 或 field → invalid 条件（保留在组内，恒不成立）', () => {
    const warnings: string[] = [];
    const design = normalizeDesign(
      {
        groups: [
          {
            conditions: [
              { field: 'x', operator: 'eq', values: ['1'] },
              { function: 'f', operator: 'eq', values: ['1'] },
            ],
          },
        ],
      },
      warnings,
    );
    const conditions = design!.groups[0]!.conditions;
    expect(conditions).toHaveLength(2);
    expect(conditions.every((c) => c.invalid === true)).toBe(true);
    expect(warnings.filter((w) => w === 'rule_condition_missing_target')).toHaveLength(2);
  });

  it('条件非对象 → 丢弃（不算 invalid）', () => {
    const warnings: string[] = [];
    const design = normalizeDesign(
      { groups: [{ conditions: ['x', { function: 'f', field: 'x', operator: 'eq', values: ['1'] }] }] },
      warnings,
    );
    expect(design!.groups[0]!.conditions).toHaveLength(1);
    expect(warnings).toContain('rule_condition_not_object');
  });

  it('组数 / 每组条数超 5 不拒绝', () => {
    const conditions = Array.from({ length: 7 }, (_, i) => ({
      function: 'f',
      field: `f${i}`,
      operator: 'eq',
      values: ['1'],
    }));
    const groups = Array.from({ length: 6 }, () => ({ conditions }));

    const warnings: string[] = [];
    const design = normalizeDesign({ groups }, warnings);
    expect(design).not.toBeNull();
    expect(design!.groups).toHaveLength(6);
    expect(design!.groups[0]!.conditions).toHaveLength(7);
  });

  it('pass_message / fail_message 透传（trim 后非空才写）', () => {
    const design = normalizeDesign(
      {
        groups: [{ conditions: [{ function: 'f', field: 'x', operator: 'eq', values: ['1'] }] }],
        pass_message: '  通过  ',
        fail_message: '   ',
      },
      [],
    );
    expect(design!.passMessage).toBe('通过');
    expect(design!.failMessage).toBeUndefined();
  });
});
