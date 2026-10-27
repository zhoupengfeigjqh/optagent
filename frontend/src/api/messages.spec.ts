/**
 * 单测：SSE 事件解码（`decodeStreamEvent`）与发消息请求体（`buildSendMessageBody`）。
 *
 * 重点守住 HITL 的 `interaction_request`：它是**逐字段构造**的（不是透传），
 * 新增字段忘了映射就会被静默丢弃——`rules_field` 与 `tool_description` 正是这样漏掉的
 * （2026-09-23 修复：前者导致 HITL 弹窗里的「从算法规则选择」入口永不出现）。
 */
import { describe, expect, it } from 'vitest'

import { buildSendMessageBody, decodeStreamEvent } from './messages'

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

describe('decodeStreamEvent —— done.next_actions（007 修订：卡片直推）', () => {
  function doneData(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const event = decodeStreamEvent({
      event: 'done',
      data: JSON.stringify({
        finish_reason: 'completed',
        usage: { input_tokens: 1, output_tokens: 2 },
        duration_seconds: 1.5,
        message_id: 'm-1',
        agent_name: 'demo',
        ...extra,
      }),
    })
    if (event?.type !== 'done') throw new Error('预期 done')
    return event.data as unknown as Record<string, unknown>
  }

  it('带合法卡片 → 解码并归一形状（tools / guidance 缺失补齐，与快照端点同一条校验）', () => {
    const data = doneData({
      next_actions: { message_id: 'm-1', actions: [{ prompt: '整理表格' }] },
    })

    expect(data.next_actions).toEqual({
      message_id: 'm-1',
      actions: [{ prompt: '整理表格', tools: [], guidance: '' }],
    })
  })

  it('无卡片（字段缺省 / 显式 null）→ 不写该键（= 本轮无卡片）', () => {
    expect('next_actions' in doneData()).toBe(false)
    expect('next_actions' in doneData({ next_actions: null })).toBe(false)
  })

  it('脏卡片（形状非法 / actions 为空）→ 不写该键，不抛错', () => {
    expect('next_actions' in doneData({ next_actions: { foo: 1 } })).toBe(false)
    expect('next_actions' in doneData({ next_actions: { message_id: 'm-1', actions: [] } })).toBe(
      false,
    )
  })
})

describe('buildSendMessageBody —— 隐藏工具引导（004）', () => {
  const base = {
    content: '帮我梳理昨天订单的交付风险',
    thinking: false,
    model: null,
    attachments: [],
  }

  it('有指引时随请求体下发（模型能看到，用户气泡里看不到）', () => {
    const body = buildSendMessageBody({
      ...base,
      guidance: '本轮请优先使用以下工具完成任务：read_file',
    })

    expect(body.guidance).toBe('本轮请优先使用以下工具完成任务：read_file')
    // 正文保持干净：引导绝不拼进 content
    expect(body.content).toBe('帮我梳理昨天订单的交付风险')
  })

  it('空串 / 缺省时不写该键（后端 Schema 为 additionalProperties:false）', () => {
    expect('guidance' in buildSendMessageBody(base)).toBe(false)
    expect('guidance' in buildSendMessageBody({ ...base, guidance: '' })).toBe(false)
  })
})

describe('buildSendMessageBody —— 意图聚焦跳过标记（013）', () => {
  const base = {
    content: '按交付日期梳理这批订单的风险',
    thinking: false,
    model: null,
    attachments: [],
  }

  it('预置动作入口：仅在 true 时写 skip_intent_focus', () => {
    const body = buildSendMessageBody({ ...base, skipIntentFocus: true }) as unknown as Record<
      string,
      unknown
    >
    expect(body.skip_intent_focus).toBe(true)
    // 正文保持干净：标记绝不拼进 content，也不落历史
    expect(body.content).toBe('按交付日期梳理这批订单的风险')
  })

  it('缺省 / false 时不写该键', () => {
    expect('skip_intent_focus' in buildSendMessageBody(base)).toBe(false)
    expect('skip_intent_focus' in buildSendMessageBody({ ...base, skipIntentFocus: false })).toBe(
      false,
    )
  })
})
