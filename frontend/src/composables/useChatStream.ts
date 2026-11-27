
import { computed, ref, watch } from 'vue'

import { buildSendMessageBody, sendMessageStream } from '../api/messages'
import type {
  ErrorInfo,
  FeedbackValue,
  FileReference,
  InteractionSnapshot,
  StreamEvent,
  ToolTip,
  Usage,
} from '../api/types'
import { RUN_PHASE, type RunPhase, type ToolStatus } from '../constants/events'
import { toErrorInfo, toUserMessage } from '../utils/error-message'
import { isAbortError } from '../api/sse'
import {
  readStoredThinking,
  safeSessionStorage,
  writeStoredThinking,
} from '../utils/thinking-storage'
import { useSession } from './useAppSession'
import type {
  ChatStreamDeps,
  ChatStreamStore,
  PendingUserMessage,
  PlanProgressItem,
  StreamSegment,
  ToolCallState,
} from './useChatStream.types'
import { useInteractionGate } from './useInteractionGate'
import { useThreadDrafts } from './useThreadDrafts'

export type {
  ChatStreamDeps,
  ChatStreamStore,
  PendingUserMessage,
  PlanProgressItem,
  StreamSegment,
  ToolCallState,
} from './useChatStream.types'

export function createChatStreamStore(deps: ChatStreamDeps): ChatStreamStore {
  const storage = deps.storage === undefined ? safeSessionStorage() : deps.storage

  const phase = ref<RunPhase>(RUN_PHASE.IDLE)
  const streamingText = ref('')
  const streamingThinking = ref('')
  const toolCalls = ref<ToolCallState[]>([])
  const segments = ref<StreamSegment[]>([])
  /**
   * 本轮计划进度（028 FR-034）：按 `seqId` 合并，重规划改写同一编号时**原地替换**。
   *
   * 不写历史、不持久化；下一次发送时清空（`send` / `reset`），轮末由组件淡出。
   */
  const planProgress = ref<PlanProgressItem[]>([])
  const thinkingEnabled = ref(readStoredThinking(storage))
  const draft = ref('')

  /**
   * 每会话草稿（2026-10-16）：分桶规则、桶上限与"`null` 不建桶"的理由见 `useThreadDrafts`。
   * 单独成模块，是因为它自带状态与淘汰策略，与本轮运行状态机没有关系。
   */
  const drafts = useThreadDrafts(draft)

  const error = ref<ErrorInfo | null>(null)
  const usage = ref<Usage | null>(null)
  const durationSeconds = ref<number | null>(null)
  const streamingAgentName = ref<string | null>(null)
  const pendingUserMessage = ref<PendingUserMessage | null>(null)
  const lastRetryableTurn = ref<PendingUserMessage | null>(null)
  const pendingInteraction = ref<InteractionSnapshot | null>(null)
  const startedAt = ref<number | null>(null)

  const now = deps.now ?? ((): number => Date.now())
  const SILENT_AFTER_MS = 2500
  const HEARTBEAT_TICK_MS = 500
  const lastEventAt = ref(0)
  const stalled = ref(false)
  let heartbeat: ReturnType<typeof setInterval> | null = null

  /**
   * 追加正文增量：仍落在末尾的文字段就续写，否则另起一段。
   *
   * "工具之后的文字必须另起一段"正是 A-lite 的全部含义——没有这条，多轮工具的内容
   * 又会被合并进同一段，渲染顺序回退成"工具在上、正文在下"。
   */
  function appendSegmentText(delta: string): void {
    const items = segments.value
    const last = items[items.length - 1]
    if (last !== undefined && last.kind === 'text') {
      segments.value = [...items.slice(0, -1), { kind: 'text', text: last.text + delta }]
      return
    }
    segments.value = [...items, { kind: 'text', text: delta }]
  }

  function pushSegmentTool(call: ToolCallState): void {
    segments.value = [...segments.value, { kind: 'tool', call }]
  }

  /**
   * 计划进度合并：同 `seqId` 原位替换（重规划会改写同一编号的步名/状态），新编号追加。
   *
   * 滚动规划只往后加编号，失败重规划会让编号跳变——两种都按"编号唯一"处理，
   * 进度条因此不会出现同一步的两行。
   */
  function mergePlanProgress(items: PlanProgressItem[], next: PlanProgressItem): PlanProgressItem[] {
    const index = items.findIndex((item) => item.seqId === next.seqId)
    if (index === -1) return [...items, next]
    return items.map((item, i) => (i === index ? next : item))
  }

  function settleSegmentTool(callId: string, status: ToolStatus): void {
    segments.value = segments.value.map((segment) =>
      segment.kind === 'tool' && segment.call.call_id === callId
        ? { kind: 'tool', call: { ...segment.call, status } }
        : segment,
    )
  }

  function markEvent(): void {
    lastEventAt.value = now()
    stalled.value = false
  }

  function stopHeartbeat(): void {
    if (heartbeat !== null) {
      clearInterval(heartbeat)
      heartbeat = null
    }
    stalled.value = false
  }

  function startHeartbeat(): void {
    stopHeartbeat()
    heartbeat = setInterval(() => {
      if (phase.value !== RUN_PHASE.STREAMING || pendingInteraction.value !== null) {
        stalled.value = false
        return
      }
      stalled.value = now() - lastEventAt.value >= SILENT_AFTER_MS
    }, HEARTBEAT_TICK_MS)
  }

  let controller: AbortController | null = null
  let runToken = 0
  let terminalFailure = false

  const hasThinking = computed(() => thinkingEnabled.value && streamingThinking.value.trim() !== '')

  watch(thinkingEnabled, (value) => writeStoredThinking(storage, value))

  /**
   * 切换会话 → 存旧草稿、清空本轮流式状态、取回新草稿（三件事同一时刻，不能分家：
   * 分开做就会出现"草稿已经换成新会话的、流式状态还挂在旧会话"的中间态）。
   */
  watch(
    () => deps.activeThreadId.value,
    (next, previous) => {
      drafts.stash(previous)
      reset()
      draft.value = drafts.take(next)
    },
  )

  function reset(): void {
    // 先作废旧轮令牌：被中止的旧流此后的 catch/finally 一律不得再写状态
    runToken += 1
    controller?.abort()
    controller = null
    phase.value = RUN_PHASE.IDLE
    streamingText.value = ''
    streamingThinking.value = ''
    toolCalls.value = []
    segments.value = []
    error.value = null
    usage.value = null
    durationSeconds.value = null
    streamingAgentName.value = null
    pendingUserMessage.value = null
    lastRetryableTurn.value = null
    pendingInteraction.value = null
    startedAt.value = null
    planProgress.value = []
    // 静默心跳必须随本轮一起停：否则切会话后旧定时器仍按新一轮的 `lastEventAt` 判断
    stopHeartbeat()
  }

  function setThinking(value: boolean): void {
    thinkingEnabled.value = value
  }

  function applyTerminal(event: StreamEvent): void {
    pendingInteraction.value = null
    if (event.type === 'done') {
      usage.value = event.data.usage
      durationSeconds.value = event.data.duration_seconds
      streamingAgentName.value = event.data.agent_name
      phase.value = event.data.message_id === null ? RUN_PHASE.ABORTED : RUN_PHASE.COMPLETED
      if (event.data.next_actions) {
        deps.applyNextActions?.(event.data.next_actions)
      }
      return
    }

    if (event.type === 'error') {
      error.value = event.data.error
      if (event.data.usage) {
        usage.value = event.data.usage
      }
      if (event.data.duration_seconds !== undefined) {
        durationSeconds.value = event.data.duration_seconds
      }
      streamingAgentName.value = event.data.agent_name
      // 服务端已终局（本轮落盘 + 释放）：本轮用户消息可安全重发
      terminalFailure = true
      phase.value = RUN_PHASE.FAILED
    }
  }

  async function send(payload: {
    content: string
    attachments: FileReference[]
    guidance?: string
    toolTips?: ToolTip[]
    skipIntentFocus?: boolean
    skill?: string
  }): Promise<void> {
    if (phase.value === RUN_PHASE.STREAMING) {
      return
    }

    const token = ++runToken
    const stale = (): boolean => token !== runToken

    const threadId = deps.activeThreadId.value
    if (!threadId) {
      deps.toast?.push('error', '请先选择数字人')
      return
    }

    streamingText.value = ''
    streamingThinking.value = ''
    toolCalls.value = []
    segments.value = []
    error.value = null
    usage.value = null
    durationSeconds.value = null
    lastRetryableTurn.value = null
    planProgress.value = []
    terminalFailure = false
    startedAt.value = now()
    streamingAgentName.value = deps.getAgentName?.() ?? null
    // 避免"AI 答完才看到自己的消息"
    pendingUserMessage.value = {
      content: payload.content,
      attachments: payload.attachments,
      ...(payload.skill ? { skill: payload.skill } : {}),
    }
    phase.value = RUN_PHASE.STREAMING
    // 静默计时从"发出请求"起算：首个 token 之前也算一轮，超时同样要给"还在跑"的提示
    markEvent()
    startHeartbeat()

    const body = buildSendMessageBody({
      content: payload.content,
      thinking: thinkingEnabled.value,
      model: deps.getModel(),
      attachments: payload.attachments,
      ...(payload.guidance ? { guidance: payload.guidance } : {}),
      ...(payload.toolTips && payload.toolTips.length > 0 ? { toolTips: payload.toolTips } : {}),
      ...(payload.skipIntentFocus === true ? { skipIntentFocus: true } : {}),
      ...(payload.skill ? { skill: payload.skill } : {}),
    })

    controller = new AbortController()

    try {
      await sendMessageStream(
        threadId,
        body,
        (event) => {
          // 过期轮的事件一律丢弃：否则切会话后旧流的增量会写进新一轮的正文
          if (stale()) return
          markEvent()
          switch (event.type) {
            case 'thinking':
              streamingThinking.value += event.data.delta
              break
            case 'content':
              streamingText.value += event.data.delta
              appendSegmentText(event.data.delta)
              break
            case 'tool_call': {
              const call: ToolCallState = {
                call_id: event.data.call_id,
                name: event.data.name,
                ...(event.data.label !== undefined ? { label: event.data.label } : {}),
                status: 'running',
              }
              toolCalls.value = [...toolCalls.value, call]
              pushSegmentTool(call)
              break
            }
            case 'tool_call_end':
              toolCalls.value = toolCalls.value.map((item) =>
                item.call_id === event.data.call_id ? { ...item, status: event.data.status } : item,
              )
              settleSegmentTool(event.data.call_id, event.data.status)
              break
            case 'plan_progress':
              planProgress.value = mergePlanProgress(planProgress.value, {
                seqId: event.data.seq_id,
                label: event.data.label,
                phase: event.data.phase,
              })
              break
            case 'interaction_request':
              // HITL：模型发起需确认的工具调用 → 弹窗（倒计时从全量超时起算）
              pendingInteraction.value = {
                ...event.data,
                remaining_seconds: event.data.timeout_seconds,
              }
              break
            default:
              applyTerminal(event)
              break
          }
        },
        { baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl, signal: controller.signal },
      )

      if (stale()) return

      if (phase.value === RUN_PHASE.STREAMING) {
        error.value = { code: 'NETWORK_ERROR', message: '' }
        pendingInteraction.value = null
        phase.value = RUN_PHASE.FAILED
      } else if (phase.value === RUN_PHASE.COMPLETED) {
        await deps.onTurnFinished?.(threadId)
      }
    } catch (cause) {
      // 过期轮的失败不得改写新一轮的状态（否则新一轮被标成 aborted/failed）
      if (stale()) return
      if (isAbortError(cause)) {
        phase.value = RUN_PHASE.ABORTED
      } else {
        const info = toErrorInfo(cause)
        error.value = info
        phase.value = RUN_PHASE.FAILED
        deps.toast?.push('error', toUserMessage(info, 'send-message'))
      }
    } finally {
      // 过期轮不得清共享状态：`toolCalls`/`pendingUserMessage` 已属于新一轮，
      if (!stale()) {
        stopHeartbeat()
        toolCalls.value = []
        segments.value = []
        // 中断轮（不落盘，消息本就消失）与**服务端已终局**的失败轮都可安全重发；
        const retryable =
          phase.value === RUN_PHASE.ABORTED || (phase.value === RUN_PHASE.FAILED && terminalFailure)
        if (retryable && pendingUserMessage.value) {
          lastRetryableTurn.value = pendingUserMessage.value
        }
        // 乐观用户气泡收口：完成轮由历史真身接管，失败/中断轮维持既有降级语义（不残留、不重复）
        pendingUserMessage.value = null
        controller = null
      }
    }
  }


  /**
   * 提交消息反馈（FR-027、V-08）。
   *
   * 先本地乐观更新（`applyFeedback`）再请求后端，失败回滚为原值并提示。
   * `previous === value` 时换算为 `null`——因此无论上层已换算过的"取消值"，
   * 还是直接传入的重复值，都能落到"提交 `null` 取消"的同一语义。
   */
  async function submitFeedback(messageId: string, value: FeedbackValue): Promise<void> {
    const threadId = deps.activeThreadId.value
    if (!threadId || messageId === '') {
      return
    }

    const previous = deps.feedbackOf?.(messageId) ?? null
    const next = previous === value ? null : value

    deps.applyFeedback?.(messageId, next)
    try {
      await deps.sendFeedback?.(threadId, messageId, next)
    } catch (cause) {
      deps.applyFeedback?.(messageId, previous)
      deps.toast?.push('error', toUserMessage(toErrorInfo(cause)))
    }
  }

  async function stop(): Promise<void> {
    if (phase.value !== RUN_PHASE.STREAMING) {
      return
    }
    const threadId = deps.activeThreadId.value
    // 后端可能仍在运行（降级可观测，宪章原则九）；后端返回 stopped=false 属正常，不提示
    const pending = threadId
      ? deps.stopRun?.(threadId).catch(() => {
          deps.toast?.push('error', '本地已停止，远端运行状态未知，请稍后刷新会话确认')
        })
      : undefined
    // 先断开本地流，避免继续渲染；后端本轮不落盘
    controller?.abort()
    pendingInteraction.value = null
    // 本地立即进入中止态，不等待读取循环退出（幂等：后续 AbortError / done(stop) 结果一致）
    phase.value = RUN_PHASE.ABORTED
    await pending
  }


  const gate = useInteractionGate({
    pendingInteraction,
    activeThreadId: deps.activeThreadId,
    submit: deps.submitInteraction,
    toast: deps.toast,
  })

  async function recover(): Promise<void> {
    const threadId = deps.activeThreadId.value
    if (threadId) {
      await deps.onTurnFinished?.(threadId)
    }
    phase.value = RUN_PHASE.COMPLETED
    streamingText.value = ''
    streamingThinking.value = ''
    toolCalls.value = []
    error.value = null
  }

  return {
    phase,
    streamingText,
    streamingThinking,
    toolCalls,
    segments,
    planProgress,
    thinkingEnabled,
    draft,
    error,
    usage,
    durationSeconds,
    streamingAgentName,
    pendingUserMessage,
    lastRetryableTurn,
    startedAt,
    stalled,
    hasThinking,
    pendingInteraction,
    restoreInteraction: gate.restoreInteraction,
    submitInteraction: gate.submitInteraction,
    rejectInteraction: gate.rejectInteraction,
    send,
    submitFeedback,
    stop,
    recover,
    reset,
    setThinking,
  }
}

export function useChatStream(): ChatStreamStore {
  return useSession().chat
}
