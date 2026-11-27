import { ref, type Ref } from 'vue'

import type { FileReference, NextStepAction, ToolTip } from '../api/types'
import { nextStepSendPayload } from '../utils/next-steps'
import type { ToastStore } from './useToast'

export interface NextStepPromptDeps {
  streaming: Readonly<Ref<unknown | null>>
  currentAgent: Readonly<Ref<{ agent_name: string } | null>>
  send(
    payload: {
      content: string
      attachments: FileReference[]
      toolTips?: ToolTip[]
      skipTermCheck?: boolean
    },
    options: { settleBeforeReturn?: boolean },
  ): Promise<boolean>
  toast: ToastStore
}

export interface NextStepPrompt {
  pendingSuggestion: Ref<NextStepAction | null>
  suggestionSending: Ref<boolean>
  onPickNextStep(action: NextStepAction): void
  onCancelSuggestion(): void
  onConfirmSuggestion(): Promise<void>
}

export function useNextStepPrompt(deps: NextStepPromptDeps): NextStepPrompt {
  const { streaming, currentAgent, send, toast } = deps

  const pendingSuggestion = ref<NextStepAction | null>(null)
  const suggestionSending = ref(false)

  function onPickNextStep(action: NextStepAction): void {
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

  async function onConfirmSuggestion(): Promise<void> {
    const action = pendingSuggestion.value
    if (!action || suggestionSending.value) return
    suggestionSending.value = true
    try {
      const sent = await send(
        // 018：卡片正文是模型产出的定型提示词，不参与术语替换（否则"卡片"会被悄悄改写）
        { ...nextStepSendPayload(action), skipTermCheck: true },
        { settleBeforeReturn: false },
      )
      // 只有真发出去了才关弹窗：被拦下（会话不可用 / 发送失败）时保留提示词，用户可重试或取消；
      // 一旦发出即关（不等本轮答完）——弹窗不能陪着输出一起挂到结束
      if (sent) pendingSuggestion.value = null
    } finally {
      suggestionSending.value = false
    }
  }

  return {
    pendingSuggestion,
    suggestionSending,
    onPickNextStep,
    onCancelSuggestion,
    onConfirmSuggestion,
  }
}
