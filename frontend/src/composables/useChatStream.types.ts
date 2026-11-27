import type { ComputedRef, Ref } from 'vue'

import type {
  ErrorInfo,
  FeedbackValue,
  FileReference,
  InteractionSnapshot,
  InteractionSubmitResponse,
  ToolTip,
  Usage,
} from '../api/types'
import type { ThreadNextSteps } from '../api/threads'
import type { RunPhase, ToolStatus } from '../constants/events'
import type { InteractionSubmitBody } from './useInteractionGate'
import type { ToastStore } from './useToast'

export interface ToolCallState {
  call_id: string
  name: string
  label?: string
  status: ToolStatus
}

export type StreamSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; call: ToolCallState }

/**
 * 计划进度项（028 FR-034）：单行进度条与展开清单的展示模型。
 *
 * 只来自 SSE 瞬态，**不进历史、不持久化**；刷新页面即消失。
 */
export interface PlanProgressItem {
  seqId: number
  label: string
  phase: 'running' | 'replanned' | 'done'
}

/**
 * 本轮乐观用户消息（十七次调整）：发送即出现，流终结时清除——
 * 完成/失败/中断后由历史刷新（成功轮）或既有降级语义（失败还原草稿）接管，
 * MUST NOT 在终结后残留（否则与历史里的真身重复渲染）。
 */
export interface PendingUserMessage {
  content: string
  attachments: FileReference[]
  skill?: string
}

export interface ChatStreamDeps {
  activeThreadId: Ref<string | null>
  getModel: () => string | null
  getAgentName?: () => string | null
  stopRun?: (threadId: string) => Promise<void>
  onTurnFinished?: (threadId: string) => void | Promise<void>
  applyNextActions?: (steps: ThreadNextSteps) => void
  /** 读取某条消息当前反馈（失败回滚用） */
  feedbackOf?: (messageId: string) => FeedbackValue
  applyFeedback?: (messageId: string, value: FeedbackValue) => void
  sendFeedback?: (threadId: string, messageId: string, value: FeedbackValue) => Promise<void>
  submitInteraction?: (
    threadId: string,
    body: InteractionSubmitBody,
  ) => Promise<InteractionSubmitResponse>
  toast?: ToastStore
  storage?: Storage | null
  now?: () => number
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export interface ChatStreamStore {
  phase: Readonly<Ref<RunPhase>>
  streamingText: Readonly<Ref<string>>
  streamingThinking: Readonly<Ref<string>>
  toolCalls: Readonly<Ref<ToolCallState[]>>
  segments: Readonly<Ref<StreamSegment[]>>
  /** 本轮计划进度（按 `seqId` 合并；结束时由进度条自行淡出，不写历史） */
  planProgress: Readonly<Ref<PlanProgressItem[]>>
  thinkingEnabled: Ref<boolean>
  draft: Ref<string>
  error: Readonly<Ref<ErrorInfo | null>>
  usage: Readonly<Ref<Usage | null>>
  durationSeconds: Readonly<Ref<number | null>>
  /** 本轮回答的数字人（009 起会话归属固定；流式气泡据此标注，逐条保留以兼容存量数据） */
  streamingAgentName: Readonly<Ref<string | null>>
  pendingUserMessage: Readonly<Ref<PendingUserMessage | null>>
  lastRetryableTurn: Readonly<Ref<PendingUserMessage | null>>
  /** 本轮本地计时起点（毫秒；仅用于兜底展示） */
  startedAt: Readonly<Ref<number | null>>
  hasThinking: ComputedRef<boolean>
  stalled: Readonly<Ref<boolean>>
  pendingInteraction: Readonly<Ref<InteractionSnapshot | null>>
  restoreInteraction(snapshot: InteractionSnapshot): void
  submitInteraction(args: Record<string, unknown>): Promise<{ close: boolean; message?: string }>
  rejectInteraction(): Promise<void>
  send(payload: {
    content: string
    attachments: FileReference[]
    guidance?: string
    toolTips?: ToolTip[]
    skipIntentFocus?: boolean
    skill?: string
  }): Promise<void>
  /** 提交消息反馈：乐观更新 + 失败回滚；同值重复提交 = 取消（V-08） */
  submitFeedback(messageId: string, value: FeedbackValue): Promise<void>
  stop(): Promise<void>
  recover(): Promise<void>
  reset(): void
  setThinking(value: boolean): void
}
