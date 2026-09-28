/**
 * 单测：入参值层（校验与提交构建）。
 *
 * 守住的语义：required 由**父级**传入、数字类型校验、结构化形状校验、
 * 提交时剪枝"未填的可选项"并收敛数字串；最复杂的真实形态作为回归样本。
 */
import { describe, expect, it } from 'vitest'

import type { FieldSchema } from './arg-schema'
import { buildArgs, isEmptyValue, isNumericValue, pickKnownKeys, validateArgs } from './arg-values'

/** 最复杂的真实形态（外部排产服务的 hd_scheduling_submit）：嵌套对象 + 对象数组 + 行内 required。
 *  仅作回归样本，模块内不含任何该工具的分支。 */
const NESTED: FieldSchema = {
  type: 'object',
  properties: {
    uid: { type: 'string' },
    input: {
      type: 'object',
      properties: {
        solvingTime: { type: 'integer' },
        targetPriorities: {
          type: 'array',
          items: {
            type: 'object',
            properties: { ruleId: { type: 'string' }, rulePriority: { type: 'integer' } },
            required: ['ruleId', 'rulePriority'],
          },
        },
      },
      required: ['solvingTime', 'targetPriorities'],
    },
  },
  required: ['uid', 'input'],
}

describe('isEmptyValue / isNumericValue', () => {
  it('未填：undefined / null / 空白串', () => {
    expect(isEmptyValue(undefined)).toBe(true)
    expect(isEmptyValue(null)).toBe(true)
    expect(isEmptyValue('   ')).toBe(true)
    expect(isEmptyValue('')).toBe(true)
    expect(isEmptyValue(0)).toBe(false)
    expect(isEmptyValue(false)).toBe(false)
    expect(isEmptyValue([])).toBe(false)
  })

  it('数字：真数字与可整体转换的数字串', () => {
    expect(isNumericValue(3)).toBe(true)
    expect(isNumericValue('3.5')).toBe(true)
    expect(isNumericValue('abc')).toBe(false)
    expect(isNumericValue('')).toBe(false)
    expect(isNumericValue(Number.NaN)).toBe(false)
  })
})

describe('validateArgs —— 标量', () => {
  const schema: FieldSchema = {
    type: 'object',
    properties: { 产线: { type: 'string' }, 数量: { type: 'integer' }, 备注: { type: 'string' } },
    required: ['产线', '数量'],
  }

  it('必填缺失 → 报字段名；可选项留空 → 通过', () => {
    expect(validateArgs(schema, { 数量: 3 })).toContain('产线')
    expect(validateArgs(schema, { 产线: 'L01', 备注: '' })).toContain('数量')
    expect(validateArgs(schema, { 产线: 'L01', 数量: 3 })).toBe('')
  })

  it('数字控件：非数字报错，数字串放行（输入框中间态）', () => {
    expect(validateArgs(schema, { 产线: 'L01', 数量: 'abc' })).toContain('数量')
    expect(validateArgs(schema, { 产线: 'L01', 数量: '3' })).toBe('')
  })

  it('只报第一个错误（长表单不刷屏）', () => {
    expect(validateArgs(schema, {})).toBe('参数「产线」为必填项')
  })
})

describe('validateArgs —— 对象分组', () => {
  const schema: FieldSchema = {
    type: 'object',
    properties: {
      input: {
        type: 'object',
        properties: { 求解时间: { type: 'integer' } },
        required: ['求解时间'],
      },
    },
  }

  it('分组存在 → 下钻报**子字段**（比"input 为必填项"可操作）', () => {
    expect(validateArgs(schema, { input: {} })).toContain('input.求解时间')
  })

  it('分组缺失且非必填 → 不下钻（JSON Schema 语义：required 只对存在的对象生效）', () => {
    expect(validateArgs(schema, {})).toBe('')
  })

  it('分组缺失但必填 → 报分组本身', () => {
    const required: FieldSchema = { ...schema, required: ['input'] }

    expect(validateArgs(required, {})).toContain('input')
  })

  it('分组值不是对象 → 报"须为对象"（而不是逐字段报缺失）', () => {
    expect(validateArgs(schema, { input: '字符串' })).toBe('参数「input」须为对象')
  })
})

describe('validateArgs —— 表格与列表', () => {
  const table: FieldSchema = {
    type: 'object',
    properties: {
      清单: {
        type: 'array',
        items: { type: 'object', properties: { 编码: { type: 'string' } }, required: ['编码'] },
      },
    },
    required: ['清单'],
  }

  it('必填数组为空 → 报"至少一行"；非必填空数组 → 通过', () => {
    expect(validateArgs(table, { 清单: [] })).toContain('至少一行')
    expect(validateArgs(table, { 清单: [{ 编码: 'R1' }] })).toBe('')
    expect(validateArgs({ properties: { 清单: table.properties } }, { 清单: [] })).toBe('')
  })

  it('数组值不是数组 → 报"须为数组"', () => {
    expect(validateArgs(table, { 清单: '字符串' })).toBe('参数「清单」须为数组')
  })

  it('行内必填列缺失 → 报带下标的完整路径', () => {
    expect(validateArgs(table, { 清单: [{ 编码: 'R1' }, {}] })).toBe('参数「清单[1].编码」为必填项')
  })

  it('行不是对象 → 报该行须为对象', () => {
    expect(validateArgs(table, { 清单: ['标量'] })).toBe('参数「清单[0]」须为对象')
  })

  it('标量列表：逐元素校验类型', () => {
    const list: FieldSchema = {
      properties: { 天数: { type: 'array', items: { type: 'integer' } } },
    }

    expect(validateArgs(list, { 天数: [1, 2] })).toBe('')
    expect(validateArgs(list, { 天数: [1, 'abc'] })).toContain('天数[1]')
  })
})

describe('validateArgs —— 最复杂真实形态（回归样本）', () => {
  const valid = {
    uid: 'admin',
    input: {
      solvingTime: 60,
      targetPriorities: [{ ruleId: 'PR001', rulePriority: 1 }],
    },
  }

  it('完整入参 → 通过', () => {
    expect(validateArgs(NESTED, valid)).toBe('')
  })

  it('缺嵌套必填项 → 精确到值路径', () => {
    const broken = { uid: 'admin', input: { targetPriorities: [{ ruleId: 'PR001', rulePriority: 1 }] } }

    expect(validateArgs(NESTED, broken)).toBe('参数「input.solvingTime」为必填项')
  })

  it('行内必填列缺失 → 精确到下标', () => {
    const broken = { ...valid, input: { solvingTime: 60, targetPriorities: [{ ruleId: 'PR001' }] } }

    expect(validateArgs(NESTED, broken)).toBe('参数「input.targetPriorities[0].rulePriority」为必填项')
  })
})

describe('buildArgs —— 提交构建', () => {
  it('剪枝未填的可选项，保留 false / 0 / null / 空数组', () => {
    const schema: FieldSchema = {
      properties: {
        开关: { type: 'boolean' },
        数量: { type: 'integer' },
        备注: { type: 'string' },
        清单: { type: 'array', items: { type: 'object' } },
      },
    }

    expect(
      buildArgs(schema, { 开关: false, 数量: 0, 备注: '', 空: undefined, 清单: [] }),
    ).toEqual({ 开关: false, 数量: 0, 清单: [] })
  })

  it('数字串收敛为数字（递归进表格单元格与列表元素）', () => {
    expect(
      buildArgs(NESTED, {
        uid: 'admin',
        input: { solvingTime: '60', targetPriorities: [{ ruleId: 'PR001', rulePriority: '2' }] },
      }),
    ).toEqual({
      uid: 'admin',
      input: { solvingTime: 60, targetPriorities: [{ ruleId: 'PR001', rulePriority: 2 }] },
    })
  })

  it('表格里的空行（未填的列全被剪掉）不会以空对象形式混进提交值', () => {
    const schema: FieldSchema = {
      properties: {
        清单: { type: 'array', items: { type: 'object', properties: { 编码: { type: 'string' } } } },
      },
    }

    expect(buildArgs(schema, { 清单: [{ 编码: 'R1' }, { 编码: '' }] })).toEqual({
      清单: [{ 编码: 'R1' }],
    })
  })

  it('不改入参（提交构建不副作用）', () => {
    const model = {
      uid: 'admin',
      input: { solvingTime: '60', targetPriorities: [{ ruleId: 'PR001', rulePriority: '2' }] },
    }

    buildArgs(NESTED, model)

    expect(model.input.solvingTime).toBe('60')
  })

  it('模型不是对象 → 返回空对象（不抛错，弹窗不因畸形值崩掉）', () => {
    expect(buildArgs(NESTED, null)).toEqual({})
  })
})

describe('pickKnownKeys —— 模型起点', () => {
  it('只保留 schema 里出现过的顶层键（看不见的不提交）', () => {
    expect(pickKnownKeys(NESTED, { uid: 'a', 额外键: 1, input: {} })).toEqual({
      uid: 'a',
      input: {},
    })
  })
})
