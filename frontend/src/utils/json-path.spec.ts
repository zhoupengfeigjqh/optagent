/**
 * 单测：JSON 值的路径读写（HITL 递归表单的定位基础）。
 *
 * 守住的语义：不改入参、中间层缺失即按段类型创建、类型不符**不静默覆盖**、
 * 空路径 = 整段替换、数组下标可定位到单元格。
 */
import { describe, expect, it } from 'vitest'

import { formatPath, pathKey, readAtPath, setAtPath } from './json-path'

describe('readAtPath', () => {
  it('按路径取值；空路径返回根', () => {
    const root = { input: { targetPriorities: [{ ruleId: 'PR001' }] } }

    expect(readAtPath(root, [])).toBe(root)
    expect(readAtPath(root, ['input', 'targetPriorities'])).toEqual([{ ruleId: 'PR001' }])
  })

  it('数组下标可定位到元素与元素内部字段', () => {
    const root = { items: [{ name: '甲' }, { name: '乙' }] }

    expect(readAtPath(root, ['items', 1])).toEqual({ name: '乙' })
    expect(readAtPath(root, ['items', 1, 'name'])).toBe('乙')
  })

  it('规则字段的典型路径：深层对象 + 数组下标混排', () => {
    const root = { input: { targetPriorities: [{ ruleId: 'PR001', rulePriority: 1 }] } }

    expect(readAtPath(root, ['input', 'targetPriorities', 0, 'rulePriority'])).toBe(1)
  })

  it('中间层缺失 / 类型不符 / 根为标量 → undefined（不抛错）', () => {
    expect(readAtPath({}, ['input', 'x'])).toBeUndefined()
    expect(readAtPath({ input: '字符串' }, ['input', 'x'])).toBeUndefined()
    expect(readAtPath({ input: [1, 2] }, ['input', 'x'])).toBeUndefined()
    expect(readAtPath({ items: [{ name: '甲' }] }, ['items', 5, 'name'])).toBeUndefined()
    expect(readAtPath({ items: { name: '甲' } }, ['items', 0])).toBeUndefined()
    expect(readAtPath('标量', ['x'])).toBeUndefined()
    expect(readAtPath(null, ['x'])).toBeUndefined()
  })
})

describe('setAtPath', () => {
  it('中间层缺失即创建空对象，并保留同级已有内容', () => {
    const root = { solvingTime: 60 }

    const result = setAtPath(root, ['targetPriorities'], [{ ruleId: 'PR001', rulePriority: 1 }])

    expect(result).toEqual({
      ok: true,
      value: { solvingTime: 60, targetPriorities: [{ ruleId: 'PR001', rulePriority: 1 }] },
    })
  })

  it('多段路径逐层创建', () => {
    expect(setAtPath({}, ['input', 'targetPriorities'], ['a'])).toEqual({
      ok: true,
      value: { input: { targetPriorities: ['a'] } },
    })
  })

  it('空路径 = 整段替换', () => {
    expect(setAtPath({ 旧: 1 }, [], ['新'])).toEqual({ ok: true, value: ['新'] })
  })

  it('**不改入参**：返回的是新对象/新数组（逐层重建）', () => {
    const root = { input: { targetPriorities: [{ ruleId: 'PR001', rulePriority: 1 }] } }

    const result = setAtPath(root, ['input', 'targetPriorities', 0, 'rulePriority'], 3)

    expect(result.ok).toBe(true)
    expect(result.ok === true && result.value).toEqual({
      input: { targetPriorities: [{ ruleId: 'PR001', rulePriority: 3 }] },
    })
    // 原值仍是 1：单元格编辑不会顺手改掉别处
    expect(root.input.targetPriorities[0]!.rulePriority).toBe(1)
  })

  it('数组下标超出长度 → 补齐空位后写入（不产生稀疏错位）', () => {
    const result = setAtPath({ items: [] }, ['items', 2, 'name'], '丙')

    expect(result).toEqual({ ok: true, value: { items: [undefined, undefined, { name: '丙' }] } })
  })

  it('根为 null/undefined 时按下标段创建数组', () => {
    expect(setAtPath(null, ['items', 0], { name: '甲' })).toEqual({
      ok: true,
      value: { items: [{ name: '甲' }] },
    })
    expect(setAtPath(undefined, [0], '首行')).toEqual({ ok: true, value: ['首行'] })
  })

  it('中间层存在但不是对象 → 失败并指出**出问题的容器**与完整目标路径（不静默覆盖）', () => {
    const result = setAtPath({ input: '字符串' }, ['input', 'targetPriorities'], ['a'])

    expect(result.ok).toBe(false)
    // 说的是"哪一层不是对象"（input），而不是末段名（targetPriorities）——
    // 后者会让用户不知道该改哪个字段
    expect(result.ok === false && result.error).toContain('「input」不是对象')
    expect(result.ok === false && result.error).toContain('input.targetPriorities')
  })

  it('该段要数组却是对象 → 同样拒绝并说明是数组不匹配', () => {
    const result = setAtPath({ items: { 甲: 1 } }, ['items', 0, 'name'], '甲')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('「items」不是数组')
    expect(result.ok === false && result.error).toContain('items[0].name')
  })

  it('该段要对象却是数组 → 拒绝（不把数组当对象塞键）', () => {
    const result = setAtPath({ input: [1, 2] }, ['input', 'targetPriorities'], ['a'])

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('「input」不是对象')
  })
})

describe('formatPath / pathKey', () => {
  it('formatPath：对象键用 `.` 连接、下标写成 `[i]`', () => {
    expect(formatPath([])).toBe('')
    expect(formatPath(['input', 'targetPriorities'])).toBe('input.targetPriorities')
    expect(formatPath(['input', 'targetPriorities', 0, 'rulePriority'])).toBe(
      'input.targetPriorities[0].rulePriority',
    )
  })

  it('pathKey：只求唯一——键名里含 `.` 的两个路径不会撞键', () => {
    expect(pathKey(['a.b'])).not.toBe(pathKey(['a', 'b']))
    expect(pathKey(['a', 0])).toBe(pathKey(['a', 0]))
  })
})
