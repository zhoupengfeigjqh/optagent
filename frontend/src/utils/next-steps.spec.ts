/**
 * 单元测试：下一步动作提示的纯函数与常量（007 修订）。
 *
 * 断言各自钉住一件容易"顺手改坏"的事：
 * 1. 固定引导句逐字固定（界面渲染，不随模型输出变化）；
 * 2. 卡片**只属于**快照归属的那条消息（历史轮不展示，切换会话不残留）；
 * 3. 点击后的载荷与首屏问题实例**同款**（正文干净、引导走隐藏通道）。
 * （修订前的拉取窗口时刻表已废除——卡片随 `done` 直推，无时刻表可测。）
 */
import { describe, expect, it } from 'vitest'
import type { AgentStarter } from '../api/types'
import type { ThreadNextSteps } from '../api/threads'
import { NEXT_STEPS_GUIDE_TEXT, nextStepSendPayload, visibleActions } from './next-steps'

function action(overrides: Partial<AgentStarter> = {}): AgentStarter {
  return { prompt: '按交付日期梳理这批订单的风险', tools: [], guidance: '', ...overrides }
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
  it('正文只有提示词、引用为空、引导原样回传（与问题实例同款）', () => {
    expect(
      nextStepSendPayload(action({ guidance: '本轮请优先使用以下工具完成任务：read_file' })),
    ).toEqual({
      content: '按交付日期梳理这批订单的风险',
      attachments: [],
      guidance: '本轮请优先使用以下工具完成任务：read_file',
    })
  })

  it('无引导时不带 `guidance` 键（后端 Schema 为 additionalProperties:false）', () => {
    expect(nextStepSendPayload(action({ guidance: '' }))).toEqual({
      content: '按交付日期梳理这批订单的风险',
      attachments: [],
    })
    expect('guidance' in nextStepSendPayload(action())).toBe(false)
  })
})
