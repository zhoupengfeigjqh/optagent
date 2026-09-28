/**
 * 单测：HITL 表单状态（模型 / JSON 草稿 / 规则入口落点 / 校验与提交）。
 *
 * 守住的语义：模型是唯一事实源且能按路径深写；JSON 文本只是草稿（非法不污染模型、
 * 也不静默覆盖已填内容）；规则写回按**完整路径**深写并保留同级值。
 */
import { describe, expect, it, vi } from 'vitest'

import type { RuleFileResponse } from '../api/types'
import { createInteractionForm, type InteractionFormDeps } from './useInteractionForm'

const RULES: RuleFileResponse = {
  filename: 'rules.xlsx',
  updated_at: '2026-09-23T00:00:00.000Z',
  columns: ['ruleId', 'rulePriority'],
  rows: [{ ruleId: 'PR001', rulePriority: 1 }],
  priority_column: 'rulePriority',
}

/** 最复杂的真实形态（外部排产服务）：嵌套对象 + 对象数组 + 行内 required。仅作回归样本。 */
const NESTED = {
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

const PROPOSED = {
  uid: 'admin',
  input: { solvingTime: 60, targetPriorities: [{ ruleId: 'PR001', rulePriority: 1 }] },
}

function make(overrides: Partial<InteractionFormDeps> = {}) {
  const loadRules = vi.fn().mockResolvedValue(RULES)
  const form = createInteractionForm({
    schema: NESTED,
    proposed: PROPOSED,
    rulesField: 'input.targetPriorities',
    loadRules,
    ...overrides,
  })
  return { form, loadRules }
}

describe('初始化与顶层字段', () => {
  it('模型是预填值的深拷贝，且只保留 schema 里出现过的顶层键（看不见的不提交）', () => {
    const proposed = { ...PROPOSED, 未知键: '不该进表单' }
    const { form } = make({ proposed })

    expect(form.model.value).toEqual(PROPOSED)
    expect(proposed.未知键).toBe('不该进表单')
  })

  it('顶层字段保持 schema 顺序，并标出 required', () => {
    const { form } = make({
      schema: { type: 'object', properties: { 甲: {}, 乙: {}, 丙: {} }, required: ['乙'] },
    })

    expect(form.topLevel.value.map((field) => field.key)).toEqual(['甲', '乙', '丙'])
    expect(form.topLevel.value.map((field) => field.required)).toEqual([false, true, false])
  })

  it('reset 回到预填值并清空草稿与操作错误', () => {
    const { form } = make()
    form.setValue(['uid'], 'zpf')
    form.toggleJsonView(['input'])
    form.onJsonInput(['input'], '{ 坏掉的')
    form.setValue(['uid', 'x'], 1) // 结构冲突 → actionError

    form.reset()

    expect(form.valueOf(['uid'])).toBe('admin')
    expect(form.isJsonView(['input'], 'group')).toBe(false)
    expect(form.actionError.value).toBe('')
  })
})

describe('取值与写值', () => {
  it('按路径深写：能写到嵌套对象的数组单元格，且保留同级值', () => {
    const { form } = make()

    form.setValue(['input', 'targetPriorities', 0, 'rulePriority'], 5)

    expect(form.valueOf(['input', 'targetPriorities', 0, 'rulePriority'])).toBe(5)
    expect(form.valueOf(['input', 'solvingTime'])).toBe(60)
  })

  it('结构冲突不静默吞掉：写不进时给出原因且不改模型', () => {
    const { form } = make()

    form.setValue(['uid', '子字段'], 1)

    expect(form.actionError.value).toContain('「uid」不是对象')
    expect(form.valueOf(['uid'])).toBe('admin')
  })
})

describe('JSON 草稿（逃逸舱）', () => {
  it('文案非法时只留在草稿里：模型保持最后一次成功解析的值，校验明确报错', () => {
    const { form } = make()
    form.toggleJsonView(['input'])

    form.onJsonInput(['input'], '{ 坏掉的')

    expect(form.jsonTextOf(['input'])).toBe('{ 坏掉的')
    expect(form.valueOf(['input'])).toEqual(PROPOSED.input)
    expect(form.validate()).toContain('input')
    expect(form.validate()).toContain('不是合法 JSON')
  })

  it('文案合法即写回模型；草稿清空不影响模型', () => {
    const { form } = make()
    form.toggleJsonView(['input'])

    form.onJsonInput(['input'], '{"solvingTime":30,"targetPriorities":[{"ruleId":"PR009","rulePriority":9}]}')
    expect(form.valueOf(['input', 'solvingTime'])).toBe(30)

    form.onJsonInput(['input'], '')
    expect(form.valueOf(['input', 'solvingTime'])).toBe(30)
  })

  it('切回表单编辑后旧草稿不再参与校验（草稿随视图一起丢弃）', () => {
    const { form } = make()
    form.toggleJsonView(['input'])
    form.onJsonInput(['input'], '{ 坏掉的')

    form.toggleJsonView(['input'])

    expect(form.isJsonView(['input'], 'group')).toBe(false)
    expect(form.validate()).toBe('')
  })

  it('schema 表达不了的形状天然是 JSON 视图（无需用户切换）', () => {
    const { form } = make({ schema: { properties: { 自由对象: { type: 'object' } } }, proposed: {} })

    expect(form.isJsonView(['自由对象'], 'json')).toBe(true)
  })
})

describe('校验与提交', () => {
  it('校验走到嵌套与行内：缺行内必填列时精确到下标', () => {
    const { form } = make()
    form.setValue(['input', 'targetPriorities'], [{ ruleId: 'PR001' }])

    expect(form.validate()).toBe('参数「input.targetPriorities[0].rulePriority」为必填项')
  })

  it('提交构建：剪枝未填项并收敛数字串', () => {
    const { form } = make()
    form.setValue(['input', 'solvingTime'], '90')

    expect(form.build()).toEqual({
      uid: 'admin',
      input: { solvingTime: 90, targetPriorities: [{ ruleId: 'PR001', rulePriority: 1 }] },
    })
  })

  it('完整入参校验通过', () => {
    expect(make().form.validate()).toBe('')
  })
})

describe('规则入口', () => {
  it('解析出完整目标路径与落点（落点即目标那一行）', () => {
    const { form } = make()

    expect(form.rulesTarget.value).toEqual(['input', 'targetPriorities'])
    expect(form.rulesAnchor.value).toEqual(['input', 'targetPriorities'])
    expect(form.isRulesAnchor(['input', 'targetPriorities'])).toBe(true)
    expect(form.isRulesAnchor(['input'])).toBe(false)
  })

  it('未声明规则字段 → 无入口', () => {
    const { form } = make({ rulesField: undefined })

    expect(form.rulesTarget.value).toBeNull()
    expect(form.rulesAnchor.value).toBeNull()
    expect(form.isRulesAnchor(['input'])).toBe(false)
  })

  it('祖先被 JSON 逃生舱接管时，落点退到最近可见的那一行（写回仍是完整路径）', () => {
    // input 未声明 properties → 渲染成一个 JSON 文本框，子字段没有独立行
    const { form } = make({ schema: { properties: { input: { type: 'object' } } }, proposed: {} })

    expect(form.rulesAnchor.value).toEqual(['input'])
    expect(form.rulesTarget.value).toEqual(['input', 'targetPriorities'])
  })

  it('反勾取值来自**当前模型**（而不是构造时的预填快照）', () => {
    const { form } = make()
    form.setValue(['input', 'targetPriorities'], [{ ruleId: 'PR009', rulePriority: 9 }])

    expect(form.rulesInitialValue()).toEqual([{ ruleId: 'PR009', rulePriority: 9 }])
  })

  it('写回：深写到目标路径，保留同级已填值', () => {
    const { form } = make()

    const error = form.applyRules([{ ruleId: 'PR002', rulePriority: 2 }])

    expect(error).toBe('')
    expect(form.valueOf(['input', 'solvingTime'])).toBe(60)
    expect(form.valueOf(['input', 'targetPriorities'])).toEqual([{ ruleId: 'PR002', rulePriority: 2 }])
    expect(form.actionError.value).toBe('')
  })

  it('目标路径上处于 JSON 编辑态且文案非法时拒绝写回：只报错、不覆盖（模型不变）', () => {
    const { form } = make()
    form.toggleJsonView(['input'])
    form.onJsonInput(['input'], '{ 坏掉的')

    const error = form.applyRules([{ ruleId: 'PR002', rulePriority: 2 }])

    expect(error).toContain('不是合法 JSON')
    expect(form.actionError.value).toContain('不是合法 JSON')
    expect(form.valueOf(['input', 'targetPriorities'])).toEqual(PROPOSED.input.targetPriorities)
    expect(form.jsonTextOf(['input'])).toBe('{ 坏掉的')
  })

  it('写回成功后，目标及其祖先的 JSON 草稿按新模型重新序列化', () => {
    const { form } = make()
    form.toggleJsonView(['input'])
    form.onJsonInput(
      ['input'],
      '{"solvingTime":60,"targetPriorities":[{"ruleId":"PR001","rulePriority":1}]}',
    )

    form.applyRules([{ ruleId: 'PR003', rulePriority: 3 }])

    expect(JSON.parse(form.jsonTextOf(['input']))).toEqual({
      solvingTime: 60,
      targetPriorities: [{ ruleId: 'PR003', rulePriority: 3 }],
    })
  })

  it('规则数据加载器由调用方注入（会话环境），原样透传', () => {
    const { form, loadRules } = make()

    expect(form.loadRules).toBe(loadRules)
  })
})
