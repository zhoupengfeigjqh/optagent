import { ref, type Ref } from 'vue'

import type { TermMatch, TermNormalizeApi, TermNormalizeResult } from '../api/term-normalize'
import type { FileReference, ToolTip } from '../api/types'

/**
 * 预检等待上限：超过即按原话发送（原则九：有界等待 + 不阻断）。
 *
 * 2026-11-20：1500 → 3000。术语替换要读本体术语表再走一遍字典，首次请求
 * （冷启动 + 术语表未进页缓存）在 1.5s 内完不成时会被判超时，用户看到的是
 * "替换没生效"而不是"超时"；放宽到 3s 仍远低于用户感知卡顿的阈值。
 */
export const REVIEW_TIMEOUT_MS = 3000

export interface TermReviewPayload {
  content: string
  attachments: FileReference[]
  guidance?: string
  toolTips?: ToolTip[]
  skipIntentFocus?: boolean
  /** 内部标记：已经过预检（或本条不该预检），避免确认后二次弹窗 */
  skipTermCheck?: boolean
}

export interface PendingTermReview {
  original: string
  normalized: string
  matches: TermMatch[]
}

export interface TermNormalizeGateDeps {
  api: TermNormalizeApi
  send(payload: TermReviewPayload, options: { settleBeforeReturn?: boolean }): Promise<boolean>
}

export interface TermNormalizeGate {
  pendingTerm: Ref<PendingTermReview | null>
  termSending: Ref<boolean>
  /**
   * 预检一次。
   *
   * @returns `true` = 已打开确认弹窗（本次**不**发送，等用户选择）；`false` = 没有替换或已降级，继续发送。
   */
  review(input: {
    content: string
    payload: TermReviewPayload
    options: { settleBeforeReturn?: boolean }
  }): Promise<boolean>
  onUseReplacement(text?: string): Promise<void>
  onKeepOriginal(): Promise<void>
}

export function useTermNormalize(deps: TermNormalizeGateDeps): TermNormalizeGate {
  const { api, send } = deps

  const pendingTerm = ref<PendingTermReview | null>(null)
  const termSending = ref(false)
  let queued: { payload: TermReviewPayload; options: { settleBeforeReturn?: boolean } } | null =
    null

  async function review(input: {
    content: string
    payload: TermReviewPayload
    options: { settleBeforeReturn?: boolean }
  }): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS)
    let result: TermNormalizeResult
    try {
      result = await api.review(input.content, controller.signal)
    } catch {
      // 超时 / 断网 / 未选数字人：按原话发送（真正的拒绝由发送链路自己报）
      return false
    } finally {
      clearTimeout(timer)
    }

    if (!result.applied || result.normalized === input.content) return false

    pendingTerm.value = {
      original: result.original,
      normalized: result.normalized,
      matches: result.matches,
    }
    queued = { payload: input.payload, options: input.options }
    return true
  }

  async function settle(useReplacement: boolean, editedText?: string): Promise<void> {
    const decision = pendingTerm.value
    const job = queued
    if (!decision || !job || termSending.value) return

    const replacement = (editedText ?? decision.normalized).trim()
    if (useReplacement && replacement === '') return

    termSending.value = true
    const sendOptions = { ...job.options, settleBeforeReturn: false as const }
    try {
      const sent = useReplacement
        ? await send(
            {
              ...job.payload,
              content: replacement,
              skipTermCheck: true,
            },
            sendOptions,
          )
        : await send({ ...job.payload, skipTermCheck: true }, sendOptions)
      if (sent) {
        pendingTerm.value = null
        queued = null
      }
    } finally {
      termSending.value = false
    }
  }

  return {
    pendingTerm,
    termSending,
    review,
    onUseReplacement: (text?: string) => settle(true, text),
    onKeepOriginal: () => settle(false),
  }
}
