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
  dedupeTitles,
  fieldLabelOf,
  isPlainObject,
  isScalarControl,
  itemSchemaOf,
  optionsOf,
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

  it('数字枚举同样是下拉（保留原始类型，不转字符串）', () => {
    // 数字取值的枚举（如"数据版本 1~5"这类语义）。
    // 注意：真实契约里这类语义只写在 description 里（字段本身是 `{"type":"integer"}`、没有 enum），
    // 这里刻意按 enum 声明，验证的是"服务方一旦声明数字枚举"时的规则
    const schema = { type: 'integer', enum: [1, 2, 3, 4, 5] }
    expect(controlOf(schema)).toBe('select')
    expect(optionsOf(schema)).toEqual([1, 2, 3, 4, 5])
  })

  it('选项形态：const 单值、anyOf/oneOf 常量集合都是下拉；联合类型不是', () => {
    expect(optionsOf({ const: 'PR001' })).toEqual(['PR001'])
    expect(controlOf({ const: 'PR001' })).toBe('select')

    expect(optionsOf({ anyOf: [{ const: '甲' }, { const: '乙' }] })).toEqual(['甲', '乙'])
    expect(optionsOf({ oneOf: [{ enum: ['甲'] }, { enum: ['乙'] }] })).toEqual(['甲', '乙'])
    expect(controlOf({ anyOf: [{ const: '甲' }, { const: '乙' }] })).toBe('select')

    // 联合**类型**（Pydantic 的 Optional 等）不能被误判成选项
    expect(optionsOf({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toEqual([])
    expect(controlOf({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe('json')

    // 空数组与缺省都保持"非下拉"语义
    expect(optionsOf({ enum: [] })).toEqual([])
    expect(optionsOf({})).toEqual([])
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
    expect(
      rulesAnchorOf({ properties: { input: { type: 'object' } } }, ['input', 'targetPriorities']),
    ).toEqual({
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

describe('fieldLabelOf —— 字段主标签（title 优先，参数名兜底）', () => {
  it('中文 title 直接作为主标签', () => {
    expect(fieldLabelOf('line', { title: '产线' })).toBe('产线')
    expect(fieldLabelOf('path', { title: '文件路径', description: '相对路径' })).toBe('文件路径')
  })

  it('title 只是参数名的排版变体（大小写 / 空格 / 下划线 / 连字符）→ 回退参数名', () => {
    expect(fieldLabelOf('image', { title: 'Image' })).toBe('image')
    expect(fieldLabelOf('state_file', { title: 'State File' })).toBe('state_file')
    expect(fieldLabelOf('state-file', { title: 'state_file' })).toBe('state-file')
  })

  it('无 title / 空白 title → 参数名（方案 A：不再用 description 首句）', () => {
    expect(fieldLabelOf('qty', { type: 'integer' })).toBe('qty')
    expect(fieldLabelOf('qty', { title: '   ' })).toBe('qty')
    expect(fieldLabelOf('image', { description: '要识别的图片：填相对路径' })).toBe('image')
  })

  it('title 非字符串 → 参数名', () => {
    expect(fieldLabelOf('qty', { title: 42 })).toBe('qty')
  })
})

describe('dedupeTitles —— 同层 title 唯一性兜底', () => {
  it('同层重名只保留先出现的，其余删 title 回退参数名', () => {
    const cleaned = dedupeTitles({
      type: 'object',
      properties: {
        line: { type: 'string', title: '产线' },
        line2: { type: 'string', title: '产线' },
      },
    })
    const props = cleaned.properties as Record<string, { title?: unknown }>
    expect(props.line.title).toBe('产线')
    expect(props.line2.title).toBeUndefined()
  })

  it('重名判据同样归一（尾随空格 / 大小写视为同名）', () => {
    const cleaned = dedupeTitles({
      type: 'object',
      properties: {
        a: { type: 'string', title: '产线' },
        b: { type: 'string', title: '  产线  ' },
      },
    })
    const props = cleaned.properties as Record<string, { title?: unknown }>
    expect(props.a.title).toBe('产线')
    expect(props.b.title).toBeUndefined()
  })

  it('数组元素 schema 递归去重', () => {
    const cleaned = dedupeTitles({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ruleId: { type: 'string', title: '编号' },
          ruleName: { type: 'string', title: '编号' },
        },
      },
    })
    const items = cleaned.items as { properties: Record<string, { title?: unknown }> }
    expect(items.properties.ruleId.title).toBe('编号')
    expect(items.properties.ruleName.title).toBeUndefined()
  })

  it('跨层同名不算冲突', () => {
    const cleaned = dedupeTitles({
      type: 'object',
      properties: {
        line: { type: 'string', title: '产线' },
        detail: { type: 'object', properties: { line: { type: 'string', title: '产线' } } },
      },
    })
    const props = cleaned.properties as Record<string, { properties?: Record<string, unknown> }>
    expect((props.line as { title?: unknown }).title).toBe('产线')
    const detail = props.detail.properties as Record<string, { title?: unknown }>
    expect(detail.line.title).toBe('产线')
  })

  it('不修改入参（纯函数）', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'string', title: '甲' },
        b: { type: 'string', title: '甲' },
      },
    }
    dedupeTitles(schema)
    const props = schema.properties as Record<string, { title?: string }>
    expect(props.b.title).toBe('甲')
  })
})
