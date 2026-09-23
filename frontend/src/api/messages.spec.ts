/**
 * 单测：SSE 事件解码（`decodeStreamEvent`）。
 *
 * 重点守住 HITL 的 `interaction_request`：它是**逐字段构造**的（不是透传），
 * 新增字段忘了映射就会被静默丢弃——`rules_field` 与 `tool_description` 正是这样漏掉的
 * （2026-09-23 修复：前者导致 HITL 弹窗里的「从算法规则选择」入口永不出现）。
 */
import { describe, expect, it } from 'vitest'

import { decodeStreamEvent } from './messages'

function interactionData(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const event = decodeStreamEvent({
    event: 'interaction_request',
    data: JSON.stringify({
      interaction_id: 'i_1',
      call_id: 'c_1',
      tool_name: 'hd-algorithm__hd_scheduling_submit',
      title: '确认调用参数：hd-algorithm__hd_scheduling_submit',
      schema: { type: 'object', properties: { input: { type: 'object' } } },
      proposed_args: { input: {} },
      required: ['input'],
      timeout_seconds: 300,
      ...extra,
    }),
  })
  if (event?.type !== 'interaction_request') throw new Error('预期 interaction_request')
  return event.data as unknown as Record<string, unknown>
}

describe('decodeStreamEvent —— interaction_request（HITL）', () => {
  it('保留 rules_field（对象路径）与 tool_description', () => {
    const data = interactionData({
      rules_field: 'input.targetPriorities',
      tool_description: '提交单工序排产任务',
    })

    expect(data.rules_field).toBe('input.targetPriorities')
    expect(data.tool_description).toBe('提交单工序排产任务')
  })

  it('顶层字段名形式的 rules_field 同样保留（存量形态不回归）', () => {
    expect(interactionData({ rules_field: 'rules' }).rules_field).toBe('rules')
  })

  it('两者缺省时**不写该键**（与后端不写空壳的同一口径）', () => {
    const data = interactionData()

    expect('rules_field' in data).toBe(false)
    expect('tool_description' in data).toBe(false)
  })

  it('脏数据（非字符串）不写入、不抛错', () => {
    const data = interactionData({ rules_field: 42, tool_description: null })

    expect('rules_field' in data).toBe(false)
    expect('tool_description' in data).toBe(false)
  })

  it('required 过滤非字符串项（既有行为，顺带守住）', () => {
    expect(interactionData({ required: ['input', 42, null] }).required).toEqual(['input'])
  })
})
