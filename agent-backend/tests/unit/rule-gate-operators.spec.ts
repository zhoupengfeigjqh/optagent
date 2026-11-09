/**
 * 单元测试：16 个算子的类型强制与比较（021）。
 *
 * 守住的口径：
 * - `boolean` 只认 `true` / `false`，其余强制失败；
 * - `eq` / `ne` 按声明类型强制，未声明类型按字符串精确比较；
 * - 数值算子与 `between` 一律数值比较，`between` 为闭区间；
 * - `contains` / `not_contains` 类型不适用时**都判不成立**（取反不能让用错算子成立）；
 * - `matches` 非法正则 / 超长文本 → false 且不抛；
 * - 取值个数与算子不符 → false。
 */
import { describe, expect, it } from 'vitest';

import {
  coerceOperatorValue,
  compareValue,
  isEmptyValue,
  REGEX_MAX_INPUT,
} from '../../src/domain/rule-gate/operators.js';

describe('coerceOperatorValue', () => {
  it('boolean 只认 true / false 字面量', () => {
    expect(coerceOperatorValue('true', 'boolean')).toBe(true);
    expect(coerceOperatorValue('false', 'boolean')).toBe(false);
    expect(coerceOperatorValue('TRUE', 'boolean')).toBeUndefined();
    expect(coerceOperatorValue('1', 'boolean')).toBeUndefined();
  });

  it('integer / number 转数字，空串与非数字失败', () => {
    expect(coerceOperatorValue('120', 'integer')).toBe(120);
    expect(coerceOperatorValue('-1.5', 'number')).toBe(-1.5);
    expect(coerceOperatorValue('abc', 'number')).toBeUndefined();
    expect(coerceOperatorValue('   ', 'integer')).toBeUndefined();
  });

  it('string 原样；未声明类型原样', () => {
    expect(coerceOperatorValue('  x  ', 'string')).toBe('  x  ');
    expect(coerceOperatorValue('123', undefined)).toBe('123');
  });
});

describe('isEmptyValue', () => {
  it('六种"空"', () => {
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue('')).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue({})).toBe(true);
    expect(isEmptyValue(Number.NaN)).toBe(false);
  });

  it('非空：0 / false / 非空串 / 非空数组 / 有键对象', () => {
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue('0')).toBe(false);
    expect(isEmptyValue([0])).toBe(false);
    expect(isEmptyValue({ a: 1 })).toBe(false);
  });
});

describe('compareValue', () => {
  it('eq / ne 按声明类型强制', () => {
    expect(compareValue(true, 'eq', ['true'], 'boolean')).toBe(true);
    expect(compareValue(true, 'eq', ['false'], 'boolean')).toBe(false);
    expect(compareValue(true, 'ne', ['false'], 'boolean')).toBe(true);
    expect(compareValue(120, 'eq', ['120'], 'integer')).toBe(true);
    expect(compareValue('120', 'eq', ['120'], 'integer')).toBe(true);
    expect(compareValue('abc', 'eq', ['120'], 'integer')).toBe(false);
  });

  it('未声明类型：按字符串精确比较', () => {
    expect(compareValue(120, 'eq', ['120'], undefined)).toBe(true);
    expect(compareValue('120', 'eq', ['120 '], undefined)).toBe(false);
    expect(compareValue({ a: 1 }, 'eq', ['{"a":1}'], undefined)).toBe(true);
  });

  it('gt / gte / lt / lte 数值比较', () => {
    expect(compareValue('120', 'gt', ['100'], 'integer')).toBe(true);
    expect(compareValue('100', 'gte', ['100'], 'integer')).toBe(true);
    expect(compareValue('99', 'lt', ['100'], 'integer')).toBe(true);
    expect(compareValue('100', 'lte', ['100'], 'integer')).toBe(true);
    expect(compareValue('abc', 'gt', ['1'], undefined)).toBe(false);
    expect(compareValue(true, 'gt', ['0'], undefined)).toBe(false);
  });

  it('between 闭区间含两端', () => {
    expect(compareValue(10, 'between', ['10', '20'], 'integer')).toBe(true);
    expect(compareValue(20, 'between', ['10', '20'], 'integer')).toBe(true);
    expect(compareValue(9, 'between', ['10', '20'], 'integer')).toBe(false);
    expect(compareValue(21, 'between', ['10', '20'], 'integer')).toBe(false);
  });

  it('contains：字符串子串与数组成员', () => {
    expect(compareValue('hello world', 'contains', ['world'], 'string')).toBe(true);
    expect(compareValue(['a', 'b'], 'contains', ['b'], undefined)).toBe(true);
    expect(compareValue(['a', 'b'], 'contains', ['c'], undefined)).toBe(false);
  });

  it('not_contains：类型不适用时同样判不成立（不取反）', () => {
    expect(compareValue('hello', 'not_contains', ['world'], 'string')).toBe(true);
    expect(compareValue(120, 'not_contains', ['1'], 'number')).toBe(false);
  });

  it('starts_with / ends_with：非字符串不成立', () => {
    expect(compareValue('abcdef', 'starts_with', ['abc'], 'string')).toBe(true);
    expect(compareValue('abcdef', 'ends_with', ['def'], 'string')).toBe(true);
    expect(compareValue(120, 'starts_with', ['1'], 'number')).toBe(false);
  });

  it('matches：正常匹配、非法正则、超长文本都不抛', () => {
    expect(compareValue('PO-2026-001', 'matches', ['^PO-\\d{4}'], 'string')).toBe(true);
    expect(compareValue('PO-2026-001', 'matches', ['['], 'string')).toBe(false);
    expect(compareValue('a'.repeat(REGEX_MAX_INPUT + 1), 'matches', ['a'], 'string')).toBe(false);
    expect(compareValue(120, 'matches', ['1'], 'number')).toBe(false);
  });

  it('in / not_in：集合成员与取反', () => {
    expect(compareValue('A', 'in', ['A', 'B'], 'string')).toBe(true);
    expect(compareValue('C', 'in', ['A', 'B'], 'string')).toBe(false);
    expect(compareValue('C', 'not_in', ['A', 'B'], 'string')).toBe(true);
    expect(compareValue(2, 'in', ['1', '2'], 'integer')).toBe(true);
  });

  it('empty / not_empty：忽略 values', () => {
    expect(compareValue('', 'empty', [], 'string')).toBe(true);
    expect(compareValue('x', 'empty', [], 'string')).toBe(false);
    expect(compareValue('x', 'not_empty', [], 'string')).toBe(true);
  });

  it('取值个数与算子不符 → false', () => {
    expect(compareValue(10, 'between', ['10'], 'integer')).toBe(false);
    expect(compareValue('x', 'eq', [], 'string')).toBe(false);
    expect(compareValue('x', 'eq', ['x', 'y'], 'string')).toBe(false);
    expect(compareValue('x', 'in', [], 'string')).toBe(false);
  });

  it('缺失值（undefined / null）一律不成立（empty 除外）', () => {
    expect(compareValue(undefined, 'eq', ['1'], 'string')).toBe(false);
    expect(compareValue(null, 'ne', ['1'], 'string')).toBe(false);
    expect(compareValue(null, 'not_in', ['1'], 'string')).toBe(false);
    expect(compareValue(null, 'empty', [], 'string')).toBe(true);
  });
});
