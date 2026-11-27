import { type Ref } from 'vue'

import type { InteractionSnapshot, InteractionSubmitResponse } from '../api/types'
import { toErrorInfo, toUserMessage } from '../utils/error-message'
import type { ToastStore } from './useToast'

/**
 * 提交/拒绝工具调用的请求体（`POST /api/threads/{id}/interaction`）。
 *
 * 放在此处是为了让它**只有一处声明**：`ChatStreamDeps.submitInteraction` 与
 * 本模块的注入口共用这一个形状，避免两边各写一份内联字面量而悄悄漂移。
 */
export interface InteractionSubmitBody {
  interaction_id: string
  action: 'submit' | 'reject'
  args?: Record<string, unknown>
}

export interface InteractionGateDeps {
  pendingInteraction: Ref<InteractionSnapshot | null>
  activeThreadId: Ref<string | null>
  submit?:
    | ((threadId: string, body: InteractionSubmitBody) => Promise<InteractionSubmitResponse>)
    | undefined
  toast?: ToastStore
}

export interface InteractionGate {
  restoreInteraction(snapshot: InteractionSnapshot): void
  submitInteraction(args: Record<string, unknown>): Promise<{ close: boolean; message?: string }>
  rejectInteraction(): Promise<void>
}

export function useInteractionGate(deps: InteractionGateDeps): InteractionGate {
  const { pendingInteraction, activeThreadId, submit, toast } = deps

  function restoreInteraction(snapshot: InteractionSnapshot): void {
    if (!pendingInteraction.value) {
      pendingInteraction.value = snapshot
    }
  }

  async function submitInteraction(
    args: Record<string, unknown>,
  ): Promise<{ close: boolean; message?: string }> {
    const pending = pendingInteraction.value
    const threadId = activeThreadId.value
    if (!pending || !threadId || !submit) {
      return { close: true }
    }
    try {
      await submit(threadId, {
        interaction_id: pending.interaction_id,
        action: 'submit',
        args,
      })
      pendingInteraction.value = null
      return { close: true }
    } catch (cause) {
      const info = toErrorInfo(cause)
      if (info.code === 'SCHEMA_VALIDATION_FAILED' || info.code === 'VALIDATION_FAILED') {
        return { close: false, message: info.message !== '' ? info.message : toUserMessage(info) }
      }
      toast?.push('error', toUserMessage(info))
      pendingInteraction.value = null
      return { close: true }
    }
  }

  async function rejectInteraction(): Promise<void> {
    const pending = pendingInteraction.value
    const threadId = activeThreadId.value
    pendingInteraction.value = null
    if (!pending || !threadId || !submit) {
      return
    }
    try {
      await submit(threadId, {
        interaction_id: pending.interaction_id,
        action: 'reject',
      })
    } catch (cause) {
      // 拒绝失败（如已超时/已被处理）：不影响关闭，提示即可
      toast?.push('error', toUserMessage(toErrorInfo(cause)))
    }
  }

  return { restoreInteraction, submitInteraction, rejectInteraction }
}
