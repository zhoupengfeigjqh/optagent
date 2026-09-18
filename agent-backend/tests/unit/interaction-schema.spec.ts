/**
 * 单元测试：交互确认入参的服务端终验（interaction-schema）。
 *
 * 守住的安全边界：用户提交的 args 在注入真实工具调用前 MUST 按 inputSchema 校验。
 * - 支持子集：object/string/integer/number/boolean/array、required、enum、
 *   minLength/maxLength、minimum/maximum、items、additionalProperties:false
 * - 多错误全量收集；不支持的校验关键字静默忽略（宁可少拦不可误拦）
 */
import { describe, expect, it } from 'vitest';

import { validateInteractionArgs } from '../../src/domain/interaction-schema.js';

const SCHEMA = {
  type: 'object',
  properties: {
    产线编号: { type: 'string', minLength: 2 },
    计划量: { type: 'integer', minimum: 1 },
    电价类型: { type: 'string', enum: ['峰', '谷', '平'] },
    备注: { type: 'string' },
  },
  required: ['产线编号', '计划量'],
  additionalProperties: false,
} as const;

describe('validateInteractionArgs', () => {
  it('合法入参通过（空错误列表）', () => {
    expect(
      validateInteractionArgs(SCHEMA, { 产线编号: 'L01', 计划量: 100, 电价类型: '峰' }),
    ).toEqual([]);
  });

  it('缺必填项：报「必填项」，且不校验缺失项的类型', () => {
    const errors = validateInteractionArgs(SCHEMA, { 计划量: 10 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('产线编号');
    expect(errors[0]).toContain('必填');
  });

  it('必填项为空串同样视为缺失', () => {
    const errors = validateInteractionArgs(SCHEMA, { 产线编号: '', 计划量: 10 });
    expect(errors.some((e) => e.includes('产线编号'))).toBe(true);
  });

  it('类型错误逐个报出：integer 收到小数、string 收到数字', () => {
    const errors = validateInteractionArgs(SCHEMA, { 产线编号: 123, 计划量: 1.5 });
    expect(errors.some((e) => e.includes('产线编号') && e.includes('字符串'))).toBe(true);
    expect(errors.some((e) => e.includes('计划量') && e.includes('整数'))).toBe(true);
  });

  it('enum 不命中：列出允许值', () => {
    const errors = validateInteractionArgs(SCHEMA, { 产线编号: 'L01', 计划量: 1, 电价类型: '尖' });
    expect(errors.some((e) => e.includes('电价类型') && e.includes('峰'))).toBe(true);
  });

  it('minimum/maxLength 范围校验', () => {
    const errors = validateInteractionArgs(SCHEMA, { 产线编号: 'L', 计划量: 0 });
    expect(errors.some((e) => e.includes('产线编号') && e.includes('长度'))).toBe(true);
    expect(errors.some((e) => e.includes('计划量') && e.includes('不得小于'))).toBe(true);
  });

  it('additionalProperties:false 拒绝未知键', () => {
    const errors = validateInteractionArgs(SCHEMA, {
      产线编号: 'L01',
      计划量: 1,
      黑客字段: true,
    });
    expect(errors.some((e) => e.includes('黑客字段'))).toBe(true);
  });

  it('数组 items 逐元素校验（报元素下标）', () => {
    const schema = {
      type: 'object',
      properties: { 清单: { type: 'array', items: { type: 'integer' } } },
    };
    const errors = validateInteractionArgs(schema, { 清单: [1, 'x', 2.5] });
    expect(errors.some((e) => e.includes('清单[1]'))).toBe(true);
    expect(errors.some((e) => e.includes('清单[2]'))).toBe(true);
    expect(errors.some((e) => e.includes('清单[0]'))).toBe(false);
  });

  it('嵌套对象递归校验（路径用点号连接）', () => {
    const schema = {
      type: 'object',
      properties: {
        区间: {
          type: 'object',
          properties: { 起: { type: 'integer' }, 止: { type: 'integer' } },
          required: ['起'],
        },
      },
    };
    const errors = validateInteractionArgs(schema, { 区间: { 止: 'abc' } });
    expect(errors.some((e) => e.includes('区间.起') && e.includes('必填'))).toBe(true);
    expect(errors.some((e) => e.includes('区间.止') && e.includes('整数'))).toBe(true);
  });

  it('schema 未声明 type：不校验类型（子集之外静默放行）', () => {
    expect(validateInteractionArgs({ properties: { a: {} } }, { a: 123 })).toEqual([]);
  });

  it('schema 形状非法（非对象）：放行（防御，不误拦）', () => {
    expect(validateInteractionArgs(null, { a: 1 })).toEqual([]);
    expect(validateInteractionArgs('not-a-schema', { a: 1 })).toEqual([]);
  });
});
