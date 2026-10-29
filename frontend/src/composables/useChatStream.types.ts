/**
 * 本轮运行状态机的**契约**（2026-10-16，自 `useChatStream.ts` 拆出）
 *
 * 拆成两个文件的理由（宪章原则二：单文件 ≤500 行）：`useChatStream.ts` 里"契约"与"实现"
 * 各占一半篇幅——契约是**对外公开面**（被 `useChatPanel` / `MessageList` / `useAppSession`
 * 等多个模块按类型消费），实现是工厂函数；两者变化的节奏也不同（加字段 vs 改时序）。
 * 分离后 `useChatStream.ts` 回到 500 行以内，且实现侧不必在 600 行文件里翻找类型定义。
 *
 * **零运行期代码**：本文件只有类型声明，故与 `src/api/types.ts` 同口径**不计入覆盖率分母**
 * （`frontend/vite.config.ts` 的 `coverage.exclude` 已登记），也**不适用**原则三的
 * "每个模块 MUST 有同名测试"——没有任何行为可测（先例：`src/api/types.ts` 无同名测试）。
 *
 * 类型仍从 `./useChatStream` 再导出，既有导入路径一律不变。
 */
import type { ComputedRef, Ref } from 'vue'

import type {
  ErrorInfo,
  FeedbackValue,
  FileReference,
  InteractionSnapshot,
  InteractionSubmitResponse,
  Usage,
} from '../api/types'
import type { ThreadNextSteps } from '../api/threads'
import type { RunPhase, ToolStatus } from '../constants/events'
import type { InteractionSubmitBody } from './useInteractionGate'
import type { ToastStore } from './useToast'

/** 进行中的工具调用（仅名称，无入参与结果）。 */
export interface ToolCallState {
  call_id: string
  name: string
  /** 人读名称（随 `tool_call` 事件下发）；缺省 = 无中文名，卡片回退 `name` */
  label?: string
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
  /**
   * 007 修订（Tail Protocol）：done 直推的当轮卡片写入（`done.next_actions` 缺省时不调用）。
   * 会话层把它接到 `nextSteps.apply`——卡片随事件即时可见，不再轮询拉取。
   */
  applyNextActions?: (steps: ThreadNextSteps) => void
  /** 读取某条消息当前反馈（失败回滚用） */
  feedbackOf?: (messageId: string) => FeedbackValue
  /** 本地乐观更新某条消息的反馈 */
  applyFeedback?: (messageId: string, value: FeedbackValue) => void
  /** 提交反馈到后端（`null` 表示取消） */
  sendFeedback?: (threadId: string, messageId: string, value: FeedbackValue) => Promise<void>
  /** HITL：提交/拒绝工具调用的人工确认（`POST /api/threads/{id}/interaction`） */
  submitInteraction?: (
    threadId: string,
    body: InteractionSubmitBody,
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
  /**
   * 输入区文本（发送前保留、失败时保留，FR-013 相关场景）。
   * **按会话分桶**：切换会话时旧会话的存起来、新会话的取回来（见 `useThreadDrafts`）。
   */
  draft: Ref<string>
  error: Readonly<Ref<ErrorInfo | null>>
  usage: Readonly<Ref<Usage | null>>
  durationSeconds: Readonly<Ref<number | null>>
  /** 本轮回答的数字人（009 起会话归属固定；流式气泡据此标注，逐条保留以兼容存量数据） */
  streamingAgentName: Readonly<Ref<string | null>>
  /**
   * 本轮乐观用户消息（十七次调整）：发送即出现，流终结时清除；`null` = 无进行中轮次。
   * 与 `streaming*` 瞬态同生命周期，故同在 `reset()` / `finally` 收口。
   */
  pendingUserMessage: Readonly<Ref<PendingUserMessage | null>>
  /**
   * 最近一个**可重试轮**的用户消息缓存（收尾时从 `pendingUserMessage` 抢救）：
   * 「重新生成」/「重试本轮」的数据源；新一轮发送或 `reset()` 时清除。
   * 中断轮不落盘（用户消息本就消失），缓存仅为重试入口，不改变任何持久化语义。
   *
   * **只在"可安全重发"时置位**（字段名即不变式：非 `null` ⇔ 可重试）：
   * - `aborted`（用户点了停止）：本轮已丢弃，重发不会撞车 ✅
   * - `failed` 且**服务端已终局**（收到 `error` 终结事件）：后端已收尾，重发安全 ✅
   * - `failed` 但属**断连/传输层**（流无终结事件、请求异常）：后端那一轮可能仍在跑
   *   （断连 = 仅退订，`run` 照跑落盘），此时重发会被 409 `THREAD_RUN_ACTIVE` 挡回——
   *   正确动作是先 `recover()` 重拉历史看后端到底答完了没有 ❌（保持 `null`）
   */
  lastRetryableTurn: Readonly<Ref<PendingUserMessage | null>>
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
  submitInteraction(args: Record<string, unknown>): Promise<{ close: boolean; message?: string }>
  /** 拒绝本次调用（弹窗始终关闭；后端把拒绝作为工具结果交给模型收尾） */
  rejectInteraction(): Promise<void>
  send(payload: { content: string; attachments: FileReference[] }): Promise<void>
  /** 用 `lastRetryableTurn` 重发上一轮（中断气泡「重新生成」/ 失败块「重试本轮」，复用 `send` 全链路） */
  regenerate(): Promise<void>
  /** 提交消息反馈：乐观更新 + 失败回滚；同值重复提交 = 取消（V-08） */
  submitFeedback(messageId: string, value: FeedbackValue): Promise<void>
  stop(): Promise<void>
  recover(): Promise<void>
  reset(): void
  setThinking(value: boolean): void
}
