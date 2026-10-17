/**
 * 下一步动作卡片的确认弹窗（2026-10-16，自 `useChatPanel.ts` 抽出）
 *
 * 抽出来的理由：它是**一个小状态机**（待确认的卡片 + 发送中标志）外加三条拒绝规则，
 * 与本轮发送链路只有"调用 `onSend`"这一条联系；搬运时行为零变化
 * （宪章原则二：单文件 ≤500 行）。
 *
 * 三条拒绝规则（007 `FR-025` 的"可感知"口径，搬过来时逐条保留）：**拒绝并且不发送**——
 * - 本轮进行中：`onSend` 的通道已被占用，排队发送会让用户搞不清点了什么；
 * - 未选数字人：明确提示（会话创建也会以 `AGENT_NOT_SELECTED` 兜底）；
 * - 会话已被删除：交给 `onSend` 走既有降级（`threads.create` 失败会 toast 且保留输入）。
 *
 * 另一条口径：**只有真发出去了才关弹窗**——被拦下时保留提示词，用户可重试或取消；
 * 一旦发出即关（不等本轮答完）。`onSend` 的 `settleBeforeReturn: false` 正是为此存在。
 */
import { ref, type Ref } from 'vue'

import type { AgentStarter, FileReference } from '../api/types'
import { nextStepSendPayload } from '../utils/next-steps'
import type { ToastStore } from './useToast'

/** 本轮瞬态（只关心"是否有进行中的轮次"）。 */
export interface NextStepPromptDeps {
  /** 非 `null` = 有进行中的轮次 */
  streaming: Readonly<Ref<unknown | null>>
  /** 当前选中数字人（`null` = 未选中） */
  currentAgent: Readonly<Ref<{ agent_name: string } | null>>
  /**
   * 唯一发送链路（`useChatPanel.onSend`）：本地校验、建会话、失败还原草稿都在那里。
   * `false` = 在本地被拦下（未发出）。
   */
  send(
    payload: { content: string; attachments: FileReference[]; guidance?: string },
    options: { settleBeforeReturn?: boolean },
  ): Promise<boolean>
  toast: ToastStore
}

/** 卡片确认弹窗状态机。 */
export interface NextStepPrompt {
  /** 待确认的卡片（`null` = 弹窗关闭）；点卡片只**打开弹窗**，不发消息 */
  pendingSuggestion: Ref<AgentStarter | null>
  /** 发送进行中：弹窗两个按钮均禁用（连点只发一次） */
  suggestionSending: Ref<boolean>
  onPickNextStep(action: AgentStarter): void
  onCancelSuggestion(): void
  onConfirmSuggestion(): Promise<void>
}

export function useNextStepPrompt(deps: NextStepPromptDeps): NextStepPrompt {
  const { streaming, currentAgent, send, toast } = deps

  const pendingSuggestion = ref<AgentStarter | null>(null)
  const suggestionSending = ref(false)

  function onPickNextStep(action: AgentStarter): void {
    if (streaming.value !== null) return
    if (currentAgent.value === null) {
      toast.push('error', '请先选择数字人再发送')
      return
    }
    pendingSuggestion.value = action
  }

  function onCancelSuggestion(): void {
    pendingSuggestion.value = null
  }

  /** 确认发送：走**既有** `send` 链路（引用校验、建会话、失败还原草稿都在那里） */
  async function onConfirmSuggestion(): Promise<void> {
    const action = pendingSuggestion.value
    if (!action || suggestionSending.value) return
    suggestionSending.value = true
    try {
      // 正文只有提示词；关联工具经 `guidance` 的隐藏通道回传（与问题实例同款）
      const sent = await send(nextStepSendPayload(action), { settleBeforeReturn: false })
      // 只有真发出去了才关弹窗：被拦下（会话不可用 / 发送失败）时保留提示词，用户可重试或取消；
      // 一旦发出即关（不等本轮答完）——弹窗不能陪着输出一起挂到结束
      if (sent) pendingSuggestion.value = null
    } finally {
      suggestionSending.value = false
    }
  }

  return { pendingSuggestion, suggestionSending, onPickNextStep, onCancelSuggestion, onConfirmSuggestion }
}
