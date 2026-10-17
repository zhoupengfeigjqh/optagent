/**
 * 本轮运行状态机（FR-005~FR-007、FR-020~FR-023、FR-049、FR-050）
 *
 * 事件时序（`data-model.md` §13）：
 * `thinking*` → `content*`（可穿插成对 `tool_call` / `tool_call_end`）→ 恰好一个 `done` / `error`。
 *
 * 关键不变式：
 * - `tool_call` 入队、`tool_call_end` 出队 → 工具项**结束后立即消失**（V-05、SC-011）
 * - `done.message_id === null` ⇒ `aborted`（中断轮不落盘，不展示操作与用量）
 * - 收尾时 `aborted` / **服务端已终局的 `error`** ⇒ `lastRetryableTurn` 置位（可安全重发）；
 *   断连与传输层失败不置位（后端那一轮可能仍在跑，重发会撞 409 → 应走 `recover()`）
 * - 读取异常 ⇒ `failed`，并通过 `recover()` 重新拉取最终结果（FR-050、SC-020）
 * - `phase === 'streaming'` ⇒ 发送按钮置灰（FR-006）、数字人切换置灰（FR-036）（V-06）
 * - 发送即出现乐观用户气泡（`pendingUserMessage`，十七次调整）：历史刷新（`onTurnFinished`）
 *   只在流**完成后**触发，若无乐观插入，用户消息要等整轮答完才显示
 *
 * 性能（D6）：增量文本用**单一 ref 累积**，不做逐字数组 push；Vue 的调度器在同一 tick 内合并刷新。
 */

import { computed, ref, watch } from 'vue'

import { buildSendMessageBody, sendMessageStream } from '../api/messages'
import type {
  ErrorInfo,
  FeedbackValue,
  FileReference,
  InteractionSnapshot,
  StreamEvent,
  Usage,
} from '../api/types'
import { RUN_PHASE, type RunPhase } from '../constants/events'
import { toErrorInfo, toUserMessage } from '../utils/error-message'
import { isAbortError } from '../api/sse'
import { readStoredThinking, safeSessionStorage, writeStoredThinking } from '../utils/thinking-storage'
import { useSession } from './useAppSession'
import type {
  ChatStreamDeps,
  ChatStreamStore,
  PendingUserMessage,
  ToolCallState,
} from './useChatStream.types'
import { useInteractionGate } from './useInteractionGate'
import { useThreadDrafts } from './useThreadDrafts'

/**
 * 对外契约（状态形状与依赖注入面）在 `./useChatStream.types`——纯类型文件、零运行期代码，
 * 不计入覆盖率分母（与 `src/api/types.ts` 同口径）。此处**再导出**，既有导入路径不变。
 */
export type {
  ChatStreamDeps,
  ChatStreamStore,
  PendingUserMessage,
  ToolCallState,
} from './useChatStream.types'

/** 创建聊天流状态。 */
export function createChatStreamStore(deps: ChatStreamDeps): ChatStreamStore {
  const storage = deps.storage === undefined ? safeSessionStorage() : deps.storage

  const phase = ref<RunPhase>(RUN_PHASE.IDLE)
  const streamingText = ref('')
  const streamingThinking = ref('')
  const toolCalls = ref<ToolCallState[]>([])
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
  let controller: AbortController | null = null
  /**
   * 本轮是否以**服务端终局**的 `error` 事件收尾（仅本轮发送期间有效）。
   * 与"断连/传输层失败"的区别决定 `lastRetryableTurn` 是否置位：见该字段的注释。
   */
  let terminalFailure = false

  const canSend = computed(() => phase.value !== RUN_PHASE.STREAMING && draft.value.trim() !== '')
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
    lastRetryableTurn.value = null
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
      // 007 修订（Tail Protocol）：卡片随 done 直推，即刻写入（无卡片时字段缺省，不动现态）
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
    /** 本轮隐藏指引（004：问题实例关联工具引导）；只进本轮系统提示词，不落盘 */
    guidance?: string
  }): Promise<void> {
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
    // 新一轮发送即取代旧的可重试缓存（「重新生成」自身也走这里，随后 finally 会重新置位）
    lastRetryableTurn.value = null
    terminalFailure = false
    startedAt.value = now()
    // 本轮数字人快照（009：本轮必然由当前选中数字人执行；快照仅在存量历史里可能与上一轮不同）
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
      ...(payload.guidance ? { guidance: payload.guidance } : {}),
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
                item.call_id === event.data.call_id ? { ...item, status: event.data.status } : item,
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
      // 收尾前把用户消息抢救进 lastRetryableTurn，供「重新生成」/「重试本轮」复用：
      // 中断轮（不落盘，消息本就消失）与**服务端已终局**的失败轮都可安全重发；
      // 断连/传输层失败不缓存——后端那一轮可能仍在跑，重发会撞上 409（见该字段注释）
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

  /**
   * 「重新生成」/「重试本轮」：用 `lastRetryableTurn` 重发上一轮。
   *
   * 内容在缓存前已去除 `@文件名` 标记（发的就是净化后正文），原样重发即可；
   * 全部复用 `send()`——乐观气泡、并发校验、终结事件收口等既有不变式天然成立。
   */
  async function regenerate(): Promise<void> {
    const turn = lastRetryableTurn.value
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

  /* ---------- HITL：工具调用人工确认（实现在 `useInteractionGate`） ---------- */

  /**
   * 三个函数只围绕 `pendingInteraction` 一个状态转，自带完整语义（含"终验失败保持弹窗打开"
   * 这条最容易写错的口径），故独立成模块；这里有把状态与注入实现交进去。
   */
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
    thinkingEnabled,
    draft,
    error,
    usage,
    durationSeconds,
    streamingAgentName,
    pendingUserMessage,
    lastRetryableTurn,
    startedAt,
    canSend,
    hasThinking,
    pendingInteraction,
    restoreInteraction: gate.restoreInteraction,
    submitInteraction: gate.submitInteraction,
    rejectInteraction: gate.rejectInteraction,
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


