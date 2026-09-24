/**
 * 本轮运行状态机（FR-005~FR-007、FR-020~FR-023、FR-049、FR-050）
 *
 * 事件时序（`data-model.md` §13）：
 * `thinking*` → `content*`（可穿插成对 `tool_call` / `tool_call_end`）→ 恰好一个 `done` / `error`。
 *
 * 关键不变式：
 * - `tool_call` 入队、`tool_call_end` 出队 → 工具项**结束后立即消失**（V-05、SC-011）
 * - `done.message_id === null` ⇒ `aborted`（中断轮不落盘，不展示操作与用量）
 * - 读取异常 ⇒ `failed`，并通过 `recover()` 重新拉取最终结果（FR-050、SC-020）
 * - `phase === 'streaming'` ⇒ 发送按钮置灰（FR-006）、数字人切换置灰（FR-036）（V-06）
 * - 发送即出现乐观用户气泡（`pendingUserMessage`，十七次调整）：历史刷新（`onTurnFinished`）
 *   只在流**完成后**触发，若无乐观插入，用户消息要等整轮答完才显示
 *
 * 性能（D6）：增量文本用**单一 ref 累积**，不做逐字数组 push；Vue 的调度器在同一 tick 内合并刷新。
 */

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

import { buildSendMessageBody, sendMessageStream } from '../api/messages'
import type {
  ErrorInfo,
  FeedbackValue,
  FileReference,
  InteractionSnapshot,
  InteractionSubmitResponse,
  StreamEvent,
  Usage,
} from '../api/types'
import { RUN_PHASE, type RunPhase, type ToolStatus } from '../constants/events'
import { STORAGE_KEY_THINKING } from '../constants/limits'
import { toErrorInfo, toUserMessage } from '../utils/error-message'
import { isAbortError } from '../api/sse'
import { useSession } from './useAppSession'
import type { ToastStore } from './useToast'

/** 进行中的工具调用（仅名称，无入参与结果）。 */
export interface ToolCallState {
  call_id: string
  name: string
  status: ToolStatus
}

/**
 * 本轮乐观用户消息（十七次调整）：发送即出现，流终结时清除——
 * 完成/失败/中断后由历史刷新（成功轮）或既有降级语义（失败还原草稿）接管，
 * MUST NOT 在终结后残留（否则与历史里的真身重复渲染）。
 */
export interface PendingUserMessage {
  /** 已去除 `@文件名` 引用文本的正文 */
  content: string
  /** 结构化引用（用户气泡用它还原文件引用区） */
  attachments: FileReference[]
}

/** 构造参数。 */
export interface ChatStreamDeps {
  /** 当前会话 id（与历史列表共享） */
  activeThreadId: Ref<string | null>
  /** 取当前模型（未选择时返回 `null`，不提交 `model` 字段） */
  getModel: () => string | null
  /** 取当前选中数字人（为本轮流式气泡标注；未选中返回 `null`） */
  getAgentName?: () => string | null
  /** 中断本轮（调用后端 `/stop`） */
  stopRun?: (threadId: string) => Promise<void>
  /** 一轮结束（完成/中断/失败）后刷新会话详情 */
  onTurnFinished?: (threadId: string) => void | Promise<void>
  /** 读取某条消息当前反馈（失败回滚用） */
  feedbackOf?: (messageId: string) => FeedbackValue
  /** 本地乐观更新某条消息的反馈 */
  applyFeedback?: (messageId: string, value: FeedbackValue) => void
  /** 提交反馈到后端（`null` 表示取消） */
  sendFeedback?: (
    threadId: string,
    messageId: string,
    value: FeedbackValue,
  ) => Promise<void>
  /** HITL：提交/拒绝工具调用的人工确认（`POST /api/threads/{id}/interaction`） */
  submitInteraction?: (
    threadId: string,
    body: { interaction_id: string; action: 'submit' | 'reject'; args?: Record<string, unknown> },
  ) => Promise<InteractionSubmitResponse>
  toast?: ToastStore
  storage?: Storage | null
  /** 本地时钟（测试注入假时钟） */
  now?: () => number
  baseUrl?: string
  fetchImpl?: typeof fetch
}

/** 聊天流 composable 契约。 */
export interface ChatStreamStore {
  phase: Readonly<Ref<RunPhase>>
  streamingText: Readonly<Ref<string>>
  streamingThinking: Readonly<Ref<string>>
  toolCalls: Readonly<Ref<ToolCallState[]>>
  thinkingEnabled: Ref<boolean>
  /** 输入区文本（发送前保留、失败时保留，FR-013 相关场景） */
  draft: Ref<string>
  error: Readonly<Ref<ErrorInfo | null>>
  usage: Readonly<Ref<Usage | null>>
  durationSeconds: Readonly<Ref<number | null>>
  /** 本轮回答的数字人（会话可跨数字人；流式气泡据此标注） */
  streamingAgentName: Readonly<Ref<string | null>>
  /**
   * 本轮乐观用户消息（十七次调整）：发送即出现，流终结时清除；`null` = 无进行中轮次。
   * 与 `streaming*` 瞬态同生命周期，故同在 `reset()` / `finally` 收口。
   */
  pendingUserMessage: Readonly<Ref<PendingUserMessage | null>>
  /**
   * 最近一个中断轮的用户消息缓存（`stop` 时从 `pendingUserMessage` 抢救）：
   * 「重新生成」的数据源；新一轮发送或 `reset()` 时清除。中断轮不落盘，
   * 用户消息本就消失，缓存仅为重试入口，不改变任何持久化语义。
   */
  lastAbortedTurn: Readonly<Ref<PendingUserMessage | null>>
  /** 本轮本地计时起点（毫秒；仅用于兜底展示） */
  startedAt: Readonly<Ref<number | null>>
  canSend: ComputedRef<boolean>
  /** 本轮是否处于思考模式且已产生思考内容（决定是否渲染思考块） */
  hasThinking: ComputedRef<boolean>
  /**
   * HITL：当前等待用户确认的工具调用（弹窗渲染源）。随本轮终结/中断/切会话清除；
   * 断连后由线程详情的 `pending_interaction` 快照经 `restoreInteraction` 重建。
   */
  pendingInteraction: Readonly<Ref<InteractionSnapshot | null>>
  /** 断连恢复：后端仍有等待中的确认时重建弹窗（不覆盖已存在的） */
  restoreInteraction(snapshot: InteractionSnapshot): void
  /**
   * 提交确认参数：`close=false` 表示服务端终验失败（message 含逐字段错误），
   * 弹窗保持打开可修正重提；其余情况弹窗关闭。
   */
  submitInteraction(
    args: Record<string, unknown>,
  ): Promise<{ close: boolean; message?: string }>
  /** 拒绝本次调用（弹窗始终关闭；后端把拒绝作为工具结果交给模型收尾） */
  rejectInteraction(): Promise<void>
  send(payload: { content: string; attachments: FileReference[] }): Promise<void>
  /** 用 `lastAbortedTurn` 重发上一轮（中断气泡的「重新生成」入口，复用 `send` 全链路） */
  regenerate(): Promise<void>
  /** 提交消息反馈：乐观更新 + 失败回滚；同值重复提交 = 取消（V-08） */
  submitFeedback(messageId: string, value: FeedbackValue): Promise<void>
  stop(): Promise<void>
  recover(): Promise<void>
  reset(): void
  setThinking(value: boolean): void
}

/** 创建聊天流状态。 */
export function createChatStreamStore(deps: ChatStreamDeps): ChatStreamStore {
  const storage = deps.storage === undefined ? safeSessionStorage() : deps.storage

  const phase = ref<RunPhase>(RUN_PHASE.IDLE)
  const streamingText = ref('')
  const streamingThinking = ref('')
  const toolCalls = ref<ToolCallState[]>([])
  const thinkingEnabled = ref(readStoredThinking(storage))
  const draft = ref('')
  const error = ref<ErrorInfo | null>(null)
  const usage = ref<Usage | null>(null)
  const durationSeconds = ref<number | null>(null)
  const streamingAgentName = ref<string | null>(null)
  const pendingUserMessage = ref<PendingUserMessage | null>(null)
  const lastAbortedTurn = ref<PendingUserMessage | null>(null)
  const pendingInteraction = ref<InteractionSnapshot | null>(null)
  const startedAt = ref<number | null>(null)

  const now = deps.now ?? ((): number => Date.now())
  let controller: AbortController | null = null

  const canSend = computed(
    () => phase.value !== RUN_PHASE.STREAMING && draft.value.trim() !== '',
  )
  const hasThinking = computed(
    () => thinkingEnabled.value && streamingThinking.value.trim() !== '',
  )

  watch(thinkingEnabled, (value) => writeStoredThinking(storage, value))

  // 切换会话 → 清空本轮流式状态
  watch(
    () => deps.activeThreadId.value,
    () => reset(),
  )

  function reset(): void {
    controller?.abort()
    controller = null
    phase.value = RUN_PHASE.IDLE
    streamingText.value = ''
    streamingThinking.value = ''
    toolCalls.value = []
    error.value = null
    usage.value = null
    durationSeconds.value = null
    streamingAgentName.value = null
    pendingUserMessage.value = null
    lastAbortedTurn.value = null
    pendingInteraction.value = null
    startedAt.value = null
  }

  function setThinking(value: boolean): void {
    thinkingEnabled.value = value
  }

  function applyTerminal(event: StreamEvent): void {
    // HITL：本轮终结即无等待中的确认（提交/拒绝后工具已执行完毕，或流被中断）
    pendingInteraction.value = null
    if (event.type === 'done') {
      usage.value = event.data.usage
      durationSeconds.value = event.data.duration_seconds
      // message_id 为 null ⇒ 中断轮，不落盘、不展示操作与用量（FR-007、FR-028）
      streamingAgentName.value = event.data.agent_name
      phase.value = event.data.message_id === null ? RUN_PHASE.ABORTED : RUN_PHASE.COMPLETED
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
      phase.value = RUN_PHASE.FAILED
    }
  }

  async function send(payload: { content: string; attachments: FileReference[] }): Promise<void> {
    // 进行中直接忽略，不重复发起（FR-006）
    if (phase.value === RUN_PHASE.STREAMING) {
      return
    }

    const threadId = deps.activeThreadId.value
    if (!threadId) {
      deps.toast?.push('error', '请先选择数字人')
      return
    }

    streamingText.value = ''
    streamingThinking.value = ''
    toolCalls.value = []
    error.value = null
    usage.value = null
    durationSeconds.value = null
    // 新一轮发送即取代旧的中断缓存（「重新生成」自身也走这里，随后 finally 会重新置位）
    lastAbortedTurn.value = null
    startedAt.value = now()
    // 本轮数字人快照（会话可跨数字人：同一会话的相邻两轮可能由不同数字人回答）
    streamingAgentName.value = deps.getAgentName?.() ?? null
    // 乐观用户气泡（十七次调整）：历史刷新只在完成后触发，发送即先本地呈现，
    // 避免"AI 答完才看到自己的消息"
    pendingUserMessage.value = { content: payload.content, attachments: payload.attachments }
    phase.value = RUN_PHASE.STREAMING

    const body = buildSendMessageBody({
      content: payload.content,
      thinking: thinkingEnabled.value,
      model: deps.getModel(),
      attachments: payload.attachments,
    })

    controller = new AbortController()

    try {
      await sendMessageStream(
        threadId,
        body,
        (event) => {
          switch (event.type) {
            case 'thinking':
              streamingThinking.value += event.data.delta
              break
            case 'content':
              streamingText.value += event.data.delta
              break
            case 'tool_call':
              toolCalls.value = [
                ...toolCalls.value,
                {
                  call_id: event.data.call_id,
                  name: event.data.name,
                  status: 'running',
                },
              ]
              break
            case 'tool_call_end':
              // 002 特性（V-05 修订）：结束**不再立即移除**，而是标记为终态——
              // 这样一轮跑完前后的展示与"刷新后的历史卡片"一致；
              // 本轮真正收尾时由 finally 统一清空，交给历史消息接管
              toolCalls.value = toolCalls.value.map((item) =>
                item.call_id === event.data.call_id
                  ? { ...item, status: event.data.status }
                  : item,
              )
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

      if (phase.value === RUN_PHASE.STREAMING) {
        // 流结束但未收到终结事件：按连接中断处理
        error.value = { code: 'NETWORK_ERROR', message: '' }
        pendingInteraction.value = null
        phase.value = RUN_PHASE.FAILED
      } else if (phase.value === RUN_PHASE.COMPLETED) {
        await deps.onTurnFinished?.(threadId)
      }
    } catch (cause) {
      if (isAbortError(cause)) {
        phase.value = RUN_PHASE.ABORTED
      } else {
        const info = toErrorInfo(cause)
        error.value = info
        phase.value = RUN_PHASE.FAILED
        deps.toast?.push('error', toUserMessage(info, 'send-message'))
      }
    } finally {
      toolCalls.value = []
      // 中断轮：用户消息在清除前抢救进 lastAbortedTurn，供「重新生成」复用（不落盘语义不变）
      if (phase.value === RUN_PHASE.ABORTED && pendingUserMessage.value) {
        lastAbortedTurn.value = pendingUserMessage.value
      }
      // 乐观用户气泡收口：完成轮由历史真身接管，失败/中断轮维持既有降级语义（不残留、不重复）
      pendingUserMessage.value = null
      controller = null
    }
  }

  /**
   * 「重新生成」：用 `lastAbortedTurn` 重发上一轮。
   *
   * 内容在缓存前已去除 `@文件名` 标记（发的就是净化后正文），原样重发即可；
   * 全部复用 `send()`——乐观气泡、并发校验、终结事件收口等既有不变式天然成立。
   */
  async function regenerate(): Promise<void> {
    const turn = lastAbortedTurn.value
    if (!turn || phase.value === RUN_PHASE.STREAMING) {
      return
    }
    await send({ content: turn.content, attachments: turn.attachments })
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
    // `/stop` 失败（网络/5xx）≠ 本地未停：abort 时序不变，但须让用户可感知
    // 后端可能仍在运行（降级可观测，宪章原则九）；后端返回 stopped=false 属正常，不提示
    const pending = threadId
      ? deps.stopRun?.(threadId).catch(() => {
          deps.toast?.push('error', '本地已停止，远端运行状态未知，请稍后刷新会话确认')
        })
      : undefined
    // 先断开本地流，避免继续渲染；后端本轮不落盘
    controller?.abort()
    // HITL：中断后端的挂起点会按 reject 收尾，弹窗同步关闭
    pendingInteraction.value = null
    // 本地立即进入中止态，不等待读取循环退出（幂等：后续 AbortError / done(stop) 结果一致）
    phase.value = RUN_PHASE.ABORTED
    await pending
  }

  /* ---------- HITL：工具调用人工确认 ---------- */

  function restoreInteraction(snapshot: InteractionSnapshot): void {
    if (!pendingInteraction.value) {
      pendingInteraction.value = snapshot
    }
  }

  async function submitInteraction(
    args: Record<string, unknown>,
  ): Promise<{ close: boolean; message?: string }> {
    const pending = pendingInteraction.value
    const threadId = deps.activeThreadId.value
    if (!pending || !threadId || !deps.submitInteraction) {
      return { close: true }
    }
    try {
      await deps.submitInteraction(threadId, {
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
      deps.toast?.push('error', toUserMessage(info))
      pendingInteraction.value = null
      return { close: true }
    }
  }

  async function rejectInteraction(): Promise<void> {
    const pending = pendingInteraction.value
    const threadId = deps.activeThreadId.value
    pendingInteraction.value = null
    if (!pending || !threadId || !deps.submitInteraction) {
      return
    }
    try {
      await deps.submitInteraction(threadId, {
        interaction_id: pending.interaction_id,
        action: 'reject',
      })
    } catch (cause) {
      // 拒绝失败（如已超时/已被处理）：不影响关闭，提示即可
      deps.toast?.push('error', toUserMessage(toErrorInfo(cause)))
    }
  }

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
    thinkingEnabled,
    draft,
    error,
    usage,
    durationSeconds,
    streamingAgentName,
    pendingUserMessage,
    lastAbortedTurn,
    startedAt,
    canSend,
    hasThinking,
    pendingInteraction,
    restoreInteraction,
    submitInteraction,
    rejectInteraction,
    send,
    regenerate,
    submitFeedback,
    stop,
    recover,
    reset,
    setThinking,
  }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useChatStream(): ChatStreamStore {
  return useSession().chat
}

/* ---------- sessionStorage 读写（容错） ---------- */

function safeSessionStorage(): Storage | null {
  try {
    return typeof globalThis.sessionStorage === 'undefined' ? null : globalThis.sessionStorage
  } catch {
    return null
  }
}

function readStoredThinking(storage: Storage | null): boolean {
  try {
    return storage?.getItem(STORAGE_KEY_THINKING) === '1'
  } catch {
    return false
  }
}

function writeStoredThinking(storage: Storage | null, value: boolean): void {
  try {
    storage?.setItem(STORAGE_KEY_THINKING, value ? '1' : '0')
  } catch {
    // 存储不可用时静默降级
  }
}
