/**
 * 下一步动作提示（007 修订 · Tail Protocol）：纯函数与常量。
 *
 * 放在 `utils/` 而不是组件里，是为了让口径各自可单测（宪章原则二/三）：
 * 可见性判定、点击后的请求载荷。
 * （修订前的"轮末拉取窗口时刻表"已随独立生成链一并废除——卡片随 `done` 直推。）
 */

import type { FileReference, NextStepAction, ToolTip } from '../api/types'
import type { ThreadNextSteps } from '../api/threads'

/**
 * 固定引导句（FR-011）。
 *
 * **由界面固定渲染**，MUST NOT 取自模型输出：模型换措辞、换语言都改不了这一句；
 * 无卡片时整块不渲染，故它也不会单独出现（FR-004）。
 */
export const NEXT_STEPS_GUIDE_TEXT = '您接下来可以操作以下动作，请选择'

/**
 * 该消息下方应该展示的卡片。
 *
 * 只有**最新一轮**（快照归属的那条 assistant 消息）才展示：历史轮次一律不展示（FR-015），
 * 而"最新一轮"在后端就是快照里的 `message_id`——故这里是唯一判据，不做别的推断。
 */
export function visibleActions(steps: ThreadNextSteps | null, messageId: string): NextStepAction[] {
  if (!steps || steps.message_id === null || steps.message_id !== messageId) return []
  return steps.actions
}

/** 点击卡片后发给后端的载荷。 */
export interface NextStepSendPayload {
  /** 正文＝卡片 `prompt`：**唯一会进入历史**的部分 */
  content: string
  attachments: FileReference[]
  /** 隐藏工具提示：非空才携带（空数组 MUST NOT 出现在请求里） */
  toolTips?: ToolTip[]
}

/**
 * 卡片 → 下一轮请求载荷。
 *
 * 两条口径：
 * - `content` 只有 `prompt`（落历史、用户气泡可见）；
 * - `toolTips` 走结构化请求字段（只进本轮系统提示词，**不进历史**），
 *   且**不再跳过意图聚焦**——点击卡片后本轮仍会重新判定。
 */
export function nextStepSendPayload(action: NextStepAction): NextStepSendPayload {
  return {
    content: action.prompt,
    attachments: [],
    ...(action.tool_tips.length > 0 ? { toolTips: action.tool_tips } : {}),
  }
}
