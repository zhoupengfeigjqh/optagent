/**
 * 单元测试：下一步动作提示的纯函数与常量（007 修订 + 016）。
 *
 * 断言各自钉住一件容易"顺手改坏"的事：
 * 1. 固定引导句逐字固定（界面渲染，不随模型输出变化）；
 * 2. 卡片**只属于**快照归属的那条消息（历史轮不展示，切换会话不残留）；
 * 3. 点击后的载荷：正文只有 `prompt`，`tool_tips` 走结构化字段，
 *    **不再跳过意图聚焦**（016 口径）。
 */
import { describe, expect, it } from 'vitest'
import type { NextStepAction, ToolTip } from '../api/types'
import type { ThreadNextSteps } from '../api/threads'
import { NEXT_STEPS_GUIDE_TEXT, nextStepSendPayload, visibleActions } from './next-steps'

const TIP: ToolTip = {
  name: 'QueryPurchaseRecords',
  title: '查询采购订单信息',
  ontology_id: '1',
  ontology_name: '采购管理',
}

function action(overrides: Partial<NextStepAction> = {}): NextStepAction {
  return { prompt: '按交付日期梳理这批订单的风险', tool_tips: [TIP], ...overrides }
}

function steps(overrides: Partial<ThreadNextSteps> = {}): ThreadNextSteps {
  return { message_id: 'm-1', actions: [action()], ...overrides }
}

describe('NEXT_STEPS_GUIDE_TEXT', () => {
  it('固定引导句逐字固定（FR-011：界面固定渲染，不随模型输出变化）', () => {
    expect(NEXT_STEPS_GUIDE_TEXT).toBe('您接下来可以操作以下动作，请选择')
  })
})

describe('visibleActions', () => {
  it('id 命中 → 返回卡片；id 不匹配 / 无建议 / 无快照 → 空数组', () => {
    const value = steps()
    expect(visibleActions(value, 'm-1')).toEqual(value.actions)
    // 历史轮次：同一次快照不得在别的消息下渲染（FR-015）
    expect(visibleActions(value, 'm-0')).toEqual([])
    expect(visibleActions(steps({ message_id: null, actions: [] }), 'm-1')).toEqual([])
    expect(visibleActions(null, 'm-1')).toEqual([])
  })
})

describe('nextStepSendPayload', () => {
  it('正文只有提示词、引用为空、tool_tips 原样回传（结构化通道）', () => {
    expect(nextStepSendPayload(action())).toEqual({
      content: '按交付日期梳理这批订单的风险',
      attachments: [],
      toolTips: [TIP],
    })
  })

  it('无 tool_tips 时不带该键（后端 Schema 为 additionalProperties:false）', () => {
    expect(nextStepSendPayload(action({ tool_tips: [] }))).toEqual({
      content: '按交付日期梳理这批订单的风险',
      attachments: [],
    })
    expect('toolTips' in nextStepSendPayload(action({ tool_tips: [] }))).toBe(false)
  })

  it('016：卡片点击**不再**跳过意图聚焦', () => {
    expect('skipIntentFocus' in nextStepSendPayload(action())).toBe(false)
  })
})
