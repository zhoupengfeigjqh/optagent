/**
 * 单测：入参 schema 内省（递归表单的控件分派依据）。
 *
 * 守住的语义：控件形态**只**由 schema 推导（无工具特例）、嵌套任意深度可下行、
 * 表格列 = schema 声明列 + 值里实际出现的列、规则入口落点取"能结构化渲染到的最长前缀"。
 */
import { describe, expect, it } from 'vitest'

import {
  asSchema,
  columnKeysOf,
  controlOf,
  isPlainObject,
  isScalarControl,
  itemSchemaOf,
  labelHintOf,
  propertiesOf,
  requiredSetOf,
  rulesAnchorOf,
  schemaAtPath,
} from './arg-schema'

/** 最复杂的真实形态（外部排产服务的 hd_scheduling_submit）：嵌套对象 + 对象数组。
 *  这里只当**回归样本**用，模块内不含任何该工具的分支。 */
const NESTED_INPUT = {
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

describe('controlOf —— 控件分派', () => {
  it('标量类：enum→select、boolean→switch、整数/数字→number、字符串→text', () => {
    expect(controlOf({ enum: ['峰', '谷'], type: 'string' })).toBe('select')
    expect(controlOf({ type: 'boolean' })).toBe('switch')
    expect(controlOf({ type: 'integer' })).toBe('number')
    expect(controlOf({ type: 'number' })).toBe('number')
    expect(controlOf({ type: 'string' })).toBe('text')
  })

  it('description 含「多行」的字符串 → 多行文本（既有约定）', () => {
    expect(controlOf({ type: 'string', description: '多行备注' })).toBe('textarea')
  })

  it('object：声明了 properties → 分组；自由对象（无 properties）→ JSON 逃生舱', () => {
    expect(controlOf({ type: 'object', properties: { a: { type: 'string' } } })).toBe('group')
    expect(controlOf({ type: 'object' })).toBe('json')
    expect(controlOf({ type: 'object', properties: {} })).toBe('json')
  })

  it('array：元素是对象 → 表格（**不要求**元素声明了 properties，规则清单的列来自数据）', () => {
    expect(
      controlOf({ type: 'array', items: { type: 'object', properties: { ruleId: {} } } }),
    ).toBe('table')
    expect(controlOf({ type: 'array', items: { type: 'object' } })).toBe('table')
  })

  it('array：元素是标量/枚举 → 列表；元素是数组或无 items → JSON', () => {
    expect(controlOf({ type: 'array', items: { type: 'string' } })).toBe('list')
    expect(controlOf({ type: 'array', items: { type: 'integer' } })).toBe('list')
    expect(controlOf({ type: 'array', items: { enum: ['甲', '乙'] } })).toBe('list')
    expect(controlOf({ type: 'array' })).toBe('json')
    expect(controlOf({ type: 'array', items: { type: 'array', items: { type: 'string' } } })).toBe(
      'json',
    )
  })

  it('未声明 type：有 properties 当对象处理，否则交 JSON（不猜）', () => {
    expect(controlOf({ properties: { a: { type: 'string' } } })).toBe('group')
    expect(controlOf({})).toBe('json')
  })

  it('isScalarControl：分组/表格/列表/JSON 之外都是标量控件', () => {
    expect(isScalarControl('text')).toBe(true)
    expect(isScalarControl('number')).toBe(true)
    expect(isScalarControl('group')).toBe(false)
    expect(isScalarControl('table')).toBe(false)
  })

  it('asSchema：非对象一律当空 schema（外部服务的形状不可全信）', () => {
    expect(asSchema(null)).toEqual({})
    expect(asSchema('字符串')).toEqual({})
    expect(asSchema({ type: 'string' })).toEqual({ type: 'string' })
  })

  it('isPlainObject：数组与 null 都不算对象', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
  })
})

describe('propertiesOf / requiredSetOf / itemSchemaOf', () => {
  it('properties 保持 schema 里的键顺序；非对象 → 空数组', () => {
    expect(propertiesOf({ properties: { b: { type: 'string' }, a: { type: 'string' } } })).toEqual([
      { key: 'b', schema: { type: 'string' } },
      { key: 'a', schema: { type: 'string' } },
    ])
    expect(propertiesOf({})).toEqual([])
  })

  it('required 只收字符串项', () => {
    expect([...requiredSetOf({ required: ['a', 1, 'b'] })]).toEqual(['a', 'b'])
    expect([...requiredSetOf({})]).toEqual([])
  })

  it('items：元组形式（数组）表达不了表格列 → null', () => {
    expect(itemSchemaOf({ items: { type: 'string' } })).toEqual({ type: 'string' })
    expect(itemSchemaOf({ items: [{ type: 'string' }] })).toBeNull()
    expect(itemSchemaOf({})).toBeNull()
  })
})

describe('columnKeysOf —— 表格列', () => {
  it('schema 声明的列在前，值里实际出现的列补在后，且去重', () => {
    const items = { properties: { ruleId: {}, rulePriority: {} } }

    expect(columnKeysOf(items, [{ 规则编码: 'R001' }, { rulePriority: 1 }])).toEqual([
      'ruleId',
      'rulePriority',
      '规则编码',
    ])
  })

  it('元素 schema 未声明列时，列完全来自数据；非对象行忽略', () => {
    expect(columnKeysOf({}, [{ a: 1, b: 2 }, '标量', null])).toEqual(['a', 'b'])
    expect(columnKeysOf({}, [])).toEqual([])
  })
})

describe('schemaAtPath —— 按值路径取 schema 节点', () => {
  it('沿 properties 下行，下标沿 items 下行', () => {
    expect(schemaAtPath(NESTED_INPUT, ['input', 'targetPriorities'])).toEqual({
      type: 'array',
      items: expect.objectContaining({ type: 'object' }),
    })
    expect(schemaAtPath(NESTED_INPUT, ['input', 'targetPriorities', 0, 'rulePriority'])).toEqual({
      type: 'integer',
    })
  })

  it('路径在 schema 里走不通 → null', () => {
    expect(schemaAtPath(NESTED_INPUT, ['input', 'missing'])).toBeNull()
    expect(schemaAtPath(NESTED_INPUT, ['missing'])).toBeNull()
    expect(schemaAtPath(NESTED_INPUT, ['uid', 0])).toBeNull()
  })
})

describe('rulesAnchorOf —— 「从算法规则选择」的落点', () => {
  it('全路径都渲染得出 → 落点即目标那行（exact）', () => {
    expect(rulesAnchorOf(NESTED_INPUT, ['input', 'targetPriorities'])).toEqual({
      anchor: ['input', 'targetPriorities'],
      exact: true,
    })
  })

  it('祖先是被 JSON 逃生舱接管的自由对象 → 落点退到最近可见的那一行（非 exact）', () => {
    // input 未声明 properties → 渲染成一个 JSON 文本框，子字段没有独立行
    expect(rulesAnchorOf({ properties: { input: { type: 'object' } } }, ['input', 'targetPriorities'])).toEqual({
      anchor: ['input'],
      exact: false,
    })
  })

  it('首段就走不通 → 无落点（不渲染入口）', () => {
    expect(rulesAnchorOf(NESTED_INPUT, ['missing', 'x'])).toEqual({ anchor: [], exact: false })
  })

  it('目标自身就是 JSON 控件时，落点仍在它这一行（按钮贴着那个文本框）', () => {
    const schema = {
      properties: { rules: { type: 'array', items: { type: 'array', items: { type: 'string' } } } },
    }

    expect(rulesAnchorOf(schema, ['rules'])).toEqual({ anchor: ['rules'], exact: true })
  })
})

describe('labelHintOf —— 参数名旁的中文短标签', () => {
  it('title 与参数名同义（大小写变体）时忽略，退到 description 首句', () => {
    expect(labelHintOf('image', { title: 'Image', description: '要识别的图片：填相对路径。图片不超过 2MB' })).toBe(
      '要识别的图片：填相对路径',
    )
  })

  it('有意义的 title 直接用；都没有 → 空串；首句超长按 24 字截断', () => {
    expect(labelHintOf('line', { title: '产线' })).toBe('产线')
    expect(labelHintOf('qty', { type: 'integer' })).toBe('')
    expect(labelHintOf('x', { description: '一'.repeat(30) })).toBe(`${'一'.repeat(24)}…`)
  })
})
