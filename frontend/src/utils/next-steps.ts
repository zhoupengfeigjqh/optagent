
import type { FileReference, NextStepAction, ToolTip } from '../api/types'
import type { ThreadNextSteps } from '../api/threads'

/**
 * 固定引导句（FR-011）。
 *
 * **由界面固定渲染**，MUST NOT 取自模型输出：模型换措辞、换语言都改不了这一句；
 * 无卡片时整块不渲染，故它也不会单独出现（FR-004）。
 */
export const NEXT_STEPS_GUIDE_TEXT = '您接下来可以操作以下动作，请选择'

export function visibleActions(steps: ThreadNextSteps | null, messageId: string): NextStepAction[] {
  if (!steps || steps.message_id === null || steps.message_id !== messageId) return []
  return steps.actions
}

export interface NextStepSendPayload {
  content: string
  attachments: FileReference[]
  /** 隐藏工具提示：非空才携带（空数组 MUST NOT 出现在请求里） */
  toolTips?: ToolTip[]
}

export function nextStepSendPayload(action: NextStepAction): NextStepSendPayload {
  return {
    content: action.prompt,
    attachments: [],
    ...(action.tool_tips.length > 0 ? { toolTips: action.tool_tips } : {}),
  }
}
