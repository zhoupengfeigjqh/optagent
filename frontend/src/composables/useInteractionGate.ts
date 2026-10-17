/**
 * HITL：工具调用的人工确认闸门（2026-10-16，自 `useChatStream.ts` 抽出）
 *
 * 抽出来的理由：三件事——"断连后重建弹窗""提交参数""拒绝调用"——只围绕**一个**状态
 * （当前等待确认的工具调用）转，自带完整语义，独立于"本轮运行状态机"；
 * 搬运时行为零变化（宪章原则二：单文件 ≤500 行）。
 *
 * 一条关键口径（搬过来时逐字保留）：**服务端终验失败时弹窗必须保持打开**，
 * 并把逐字段错误交回表单展示（`close: false` + `message`），用户可修正重提；
 * 其余情况一律关闭——弹窗挂在屏幕上却没有可提交的东西，是最容易让人反复点按钮的形态。
 */
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

/** 创建参数。 */
export interface InteractionGateDeps {
  /** 等待确认的工具调用（弹窗渲染源） */
  pendingInteraction: Ref<InteractionSnapshot | null>
  /** 当前会话 id */
  activeThreadId: Ref<string | null>
  /** 提交/拒绝的注入实现（缺省 = 该能力未装配，弹窗直接关闭） */
  submit?:
    | ((threadId: string, body: InteractionSubmitBody) => Promise<InteractionSubmitResponse>)
    | undefined
  toast?: ToastStore
}

/** 工具调用人工确认闸门。 */
export interface InteractionGate {
  /** 断连恢复：后端仍有等待中的确认时重建弹窗（不覆盖已存在的） */
  restoreInteraction(snapshot: InteractionSnapshot): void
  /**
   * 提交确认参数：`close=false` 表示服务端终验失败（message 含逐字段错误），
   * 弹窗保持打开可修正重提；其余情况弹窗关闭。
   */
  submitInteraction(args: Record<string, unknown>): Promise<{ close: boolean; message?: string }>
  /** 拒绝本次调用（弹窗始终关闭；后端把拒绝作为工具结果交给模型收尾） */
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
      // 服务端终验失败：弹窗保持打开，逐字段错误交回表单展示，可修正重提
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
