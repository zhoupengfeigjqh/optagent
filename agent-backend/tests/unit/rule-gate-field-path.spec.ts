/**
 * 单元测试：`field` 路径语法与读取（021）。
 *
 * 守住的口径：
 * - 只认 `pass` / `detail.qty` / `items` / `items[].qty` / `a[].b[].c`；
 * - 空串、空段、下标（`items[0]`）一律非法；
 * - 单值路径任一段缺失 → `found=false`；投影模式下缺失元素丢弃、投影为空视为缺失；
 * - `declaredTypeOf` 同时吃"属性映射"与 JSON Schema。
 */
import { describe, expect, it } from 'vitest';

import {
  declaredTypeOf,
  parseFieldPath,
  readField,
} from '../../src/domain/rule-gate/field-path.js';

describe('parseFieldPath', () => {
  it('四种合法形态', () => {
    expect(parseFieldPath('pass')).toEqual({ segments: [{ name: 'pass', array: false }] });
    expect(parseFieldPath('detail.qty')).toEqual({
      segments: [
        { name: 'detail', array: false },
        { name: 'qty', array: false },
      ],
    });
    expect(parseFieldPath('items[].qty')).toEqual({
      segments: [
        { name: 'items', array: true },
        { name: 'qty', array: false },
      ],
    });
    expect(parseFieldPath('a[].b[].c')).toEqual({
      segments: [
        { name: 'a', array: true },
        { name: 'b', array: true },
        { name: 'c', array: false },
      ],
    });
  });

  it('空串 / 空段 / 下标 / 单侧方括号 → null', () => {
    expect(parseFieldPath('')).toBeNull();
    expect(parseFieldPath('   ')).toBeNull();
    expect(parseFieldPath('.a')).toBeNull();
    expect(parseFieldPath('a.')).toBeNull();
    expect(parseFieldPath('a..b')).toBeNull();
    expect(parseFieldPath('items[0]')).toBeNull();
    expect(parseFieldPath('items[')).toBeNull();
    expect(parseFieldPath('a[]')).toEqual({ segments: [{ name: 'a', array: true }] });
  });
});

describe('readField', () => {
  const data = {
    pass: true,
    detail: { qty: 120 },
    items: [
      { qty: 1, name: 'A' },
      { qty: 2, name: 'B' },
      { name: 'C' },
    ],
    a: [{ b: [{ c: 'x' }, { c: 'y' }] }, { b: [{ c: 'z' }] }],
  };

  it('顶层与嵌套对象', () => {
    expect(readField(data, 'pass')).toEqual({ found: true, value: true });
    expect(readField(data, 'detail.qty')).toEqual({ found: true, value: 120 });
  });

  it('数组容器本身', () => {
    const read = readField(data, 'items');
    expect(read.found).toBe(true);
    expect(read.value).toHaveLength(3);
  });

  it('元素层投影：缺失元素被丢弃', () => {
    expect(readField(data, 'items[].qty')).toEqual({ found: true, value: [1, 2] });
  });

  it('多层数组叠加', () => {
    expect(readField(data, 'a[].b[].c')).toEqual({ found: true, value: ['x', 'y', 'z'] });
  });

  it('单值路径任一段缺失 → found=false', () => {
    expect(readField(data, 'detail.missing')).toEqual({ found: false, value: undefined });
    expect(readField(data, 'missing.qty')).toEqual({ found: false, value: undefined });
  });

  it('投影为空 → 视为缺失', () => {
    expect(readField({ items: [] }, 'items[].qty')).toEqual({ found: false, value: undefined });
    expect(readField({ items: [{ other: 1 }] }, 'items[].qty')).toEqual({
      found: false,
      value: undefined,
    });
  });

  it('非对象 / null / 数组上的键读取安全', () => {
    expect(readField(null, 'pass')).toEqual({ found: false, value: undefined });
    expect(readField(42, 'pass')).toEqual({ found: false, value: undefined });
    expect(readField([{ pass: true }], 'pass')).toEqual({ found: false, value: undefined });
  });

  it('非法路径 → found=false（不抛）', () => {
    expect(() => readField(data, 'a..b')).not.toThrow();
    expect(readField(data, 'a..b')).toEqual({ found: false, value: undefined });
  });

  it('为空的单值投影（值本身是空数组）', () => {
    expect(readField({ items: [] }, 'items')).toEqual({ found: true, value: [] });
  });
});

describe('declaredTypeOf', () => {
  it('属性映射形态：顶层与嵌套', () => {
    const response = { pass: 'boolean', detail: { qty: 'integer', price: 'number' } };
    expect(declaredTypeOf(response, 'pass')).toBe('boolean');
    expect(declaredTypeOf(response, 'detail.qty')).toBe('integer');
    expect(declaredTypeOf(response, 'detail.price')).toBe('number');
  });

  it('属性映射 + 数组元素类型', () => {
    const response = { items: { qty: 'integer' } };
    expect(declaredTypeOf(response, 'items[].qty')).toBe('integer');
  });

  it('JSON Schema 形态：先 properties，数组段下钻 items', () => {
    const response = {
      type: 'object',
      properties: {
        pass: { type: 'boolean' },
        items: {
          type: 'array',
          items: { type: 'object', properties: { qty: { type: 'integer' } } },
        },
      },
    };
    expect(declaredTypeOf(response, 'pass')).toBe('boolean');
    expect(declaredTypeOf(response, 'items[].qty')).toBe('integer');
  });

  it('未声明 / 路径对不上 → undefined（不拒绝）', () => {
    expect(declaredTypeOf({}, 'pass')).toBeUndefined();
    expect(declaredTypeOf(undefined, 'pass')).toBeUndefined();
    expect(declaredTypeOf({ detail: { qty: 'integer' } }, 'detail.missing')).toBeUndefined();
    expect(declaredTypeOf({ pass: 'decimal' }, 'pass')).toBeUndefined();
  });
});
