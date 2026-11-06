/**
 * 术语替换确认（018，自 `useChatPanel.ts` 抽出）。
 *
 * 它是**发送前的一道路由**：手动输入 → 预检 → 有替换则弹窗 → 用户选"替换后"或"原话"，
 * 然后照旧走唯一发送链路。抽成独立 composable 的理由与 `useNextStepPrompt` 一致：
 * `useChatPanel.ts` 已逼近 500 行门禁，而这里是一个自带状态机的小职责。
 *
 * 四条口径（用户 2026-11-06 确认，2026-11-07 增补）：
 * - **只有手动输入**参与（卡片、重试、跳过聚焦的轮次在 `useChatPanel` 就先被排除）；
 * - **发生替换才弹窗**（`applied:false` 用户完全无感，不打断）；
 * - **替换结果可编辑、但不可为空**：正文取用户最终确认的那一版（缺省=模型替换文）；
 *   空文本 MUST NOT 发出（避免一次空轮次），弹窗保留让用户继续改；
 * - **确认后展示与提交同源**（2026-11-07 二次拍板）：气泡与历史显示的就是**实际发出的那一版**
 *   ——用户点了"使用替换后"、甚至亲手改过，聊天区再显示原话会让人以为替换没生效；
 * - **只有真发出去了才关弹窗**（`send` 返回 `false` 时保留，用户可重试或改选）；
 *   发出即关，**不等本轮答完**——`send` 必须带 `settleBeforeReturn: false`（2026-11-06 修）。
 *
 * 降级：预检超时（1.5s）或请求失败一律按**原话**继续发送——它是增强件，绝不能卡住对话。
 */
import { ref, type Ref } from 'vue'

import type { TermMatch, TermNormalizeApi, TermNormalizeResult } from '../api/term-normalize'
import type { FileReference, ToolTip } from '../api/types'

/** 预检等待上限：超过即按原话发送（原则九：有界等待 + 不阻断） */
export const REVIEW_TIMEOUT_MS = 1500

/** 发送载荷（与 `useChatPanel.onSend` 的入参同形，只多一个内部跳过标记） */
export interface TermReviewPayload {
  content: string
  attachments: FileReference[]
  guidance?: string
  toolTips?: ToolTip[]
  skipIntentFocus?: boolean
  /** 内部标记：已经过预检（或本条不该预检），避免确认后二次弹窗 */
  skipTermCheck?: boolean
}

/** 待确认的替换结果 */
export interface PendingTermReview {
  /** 用户原话（已去 `@` 标记的提交层文本） */
  original: string
  /** 替换后文本（模型将看到它） */
  normalized: string
  matches: TermMatch[]
}

export interface TermNormalizeGateDeps {
  api: TermNormalizeApi
  /** 唯一发送链路（`useChatPanel.onSend`）；`false` = 在本地被拦下 */
  send(payload: TermReviewPayload, options: { settleBeforeReturn?: boolean }): Promise<boolean>
}

export interface TermNormalizeGate {
  /** 非 `null` = 弹窗打开中 */
  pendingTerm: Ref<PendingTermReview | null>
  /** 确认发送中：两个按钮均禁用（连点只发一次） */
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
  /**
   * 使用（可编辑的）替换后的表述发送。
   *
   * @param text 用户在弹窗里编辑后的文本；缺省/空串以外的空白一律裁掉首尾。
   *   省略时用模型给出的替换文（既有行为）。
   */
  onUseReplacement(text?: string): Promise<void>
  /** 按原话继续发送 */
  onKeepOriginal(): Promise<void>
}

export function useTermNormalize(deps: TermNormalizeGateDeps): TermNormalizeGate {
  const { api, send } = deps

  const pendingTerm = ref<PendingTermReview | null>(null)
  const termSending = ref(false)
  /** 弹窗背后那次"还没发生"的发送（载荷 + 调用方的返回时机选项） */
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

    /**
     * 提交正文 = 用户最终确认的那一版（弹窗里编辑后的文本，缺省为模型替换文）。
     *
     * 首尾空白裁掉：与手动输入同口径（`Composer` 提交时即 `trim()`）。
     * 空文本 MUST NOT 发出——服务端 `content` 有 `minLength: 1`，空轮次对用户也无意义；
     * 这里直接返回（弹窗与队列都保留），处置与"发送被本地拦下"一致：用户可继续改或改选。
     */
    const replacement = (editedText ?? decision.normalized).trim()
    if (useReplacement && replacement === '') return

    termSending.value = true
    /**
     * 一律**发出即返回**（`settleBeforeReturn: false`），不等本轮答完。
     *
     * 手动输入的 `onSend` 是默认口径（等整轮结束才 resolve），若把调用方的 options
     * 原样透传，这里就会退化成"点了确认、弹窗陪着一整轮输出挂到最后才消失"——
     * 与下一步动作卡片的确认弹窗不一致（那条链路显式传了 `false`）。
     * 与卡片同语义：本地校验一过、请求已发出即视为成功，关弹窗；被本地拦下
     * （空正文 / 引用失效 / MCP 未就绪 / 会话建不出来）才返回 `false`，保留弹窗。
     */
    const sendOptions = { ...job.options, settleBeforeReturn: false as const }
    try {
      const sent = useReplacement
        ? await send(
            {
              ...job.payload,
              /*
               * 提交层正文 = 用户确认的那一版（可能被手工改过）。
               *
               * 2026-11-07 二次拍板：**不再**另送 `original_content` 去"展示留原话"——
               * 用户明确选了替换（甚至亲手改字），聊天区却显示原话，会让人以为替换没生效。
               * 现在气泡、历史、模型**同源同文**，与"所见即所发"一致。
               */
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
