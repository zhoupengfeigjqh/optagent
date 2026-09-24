/**
 * 会话列表与消息（FR-039~FR-044、V-09）
 *
 * ⚠️ 后端 `GET /api/threads` **不接受 `limit` / `offset`**（Schema `additionalProperties: false`，
 * 传参会被拒绝）。因此 10 / 100 条是**纯前端切片**：
 * 一次性拉取全部会话，"更多"只改本地切片长度，**不产生网络请求**（FR-039、FR-040、SC-014）。
 *
 * 只有**详情**接口支持分页（`limit` 默认 50 / 上限 200，`offset` 从最新往前数）。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { ThreadsApi } from '../api/threads'
import type {
  Conversation,
  ErrorInfo,
  FeedbackValue,
  InteractionSnapshot,
  Message,
  ToolCallResult,
} from '../api/types'
import { HISTORY_DEFAULT_LIMIT, HISTORY_EXPANDED_LIMIT, MESSAGE_PAGE_SIZE } from '../constants/limits'
import { toErrorInfo, toUserMessage } from '../utils/error-message'
import { useSession } from './useAppSession'
import type { ToastStore } from './useToast'

/** 历史列表切片长度。 */
export type HistoryLimit = typeof HISTORY_DEFAULT_LIMIT | typeof HISTORY_EXPANDED_LIMIT

/** 构造参数。 */
export interface ThreadsDeps {
  threads: ThreadsApi
  /** 当前会话 id（与聊天流共享） */
  activeThreadId: Ref<string | null>
  /** 当前数字人名称（新建会话必填） */
  currentAgentName: Readonly<Ref<string | null>>
  toast?: ToastStore
  pageSize?: number
}

/** 会话 composable 契约。 */
export interface ThreadsStore {
  /** 全部会话（按 `updated_at` 倒序） */
  list: Readonly<Ref<Conversation[]>>
  /** 当前切片后用于展示的会话 */
  visible: ComputedRef<Conversation[]>
  activeId: Readonly<Ref<string | null>>
  messages: Readonly<Ref<Message[]>>
  total: Readonly<Ref<number>>
  running: Readonly<Ref<boolean>>
  /** HITL：当前等待用户确认的工具调用快照（详情接口下发；无则 `null`） */
  pendingInteraction: Readonly<Ref<InteractionSnapshot | null>>
  limit: Readonly<Ref<HistoryLimit>>
  loading: Readonly<Ref<boolean>>
  error: Readonly<Ref<ErrorInfo | null>>
  hasMore: ComputedRef<boolean>
  loadList(): Promise<void>
  /** 纯前端切到 100 条（不发请求） */
  showMore(): void
  create(): Promise<void>
  select(id: string): Promise<void>
  loadMore(): Promise<void>
  refresh(): Promise<void>
  /**
   * 拉取某次工具调用的**外置结果正文**（002 特性，卡片点开时才调用）。
   *
   * 内容已被临时空间清理时后端回 410，此处**不吞错**：由卡片把它渲染成
   * "内容已清理"的降级态（TR-16），而不是错误提示。
   */
  toolCallResult(callId: string): Promise<ToolCallResult>
  /**
   * 清空当前选中并回到空态（002 特性）。
   *
   * 用于"URL 恢复出的会话已被删除"的降级：静默回空态，不报错、不留残留消息。
   */
  clearActive(): void
  /** 删除会话（乐观更新）；返回是否真正删除成功（失败已自动回滚并提示） */
  remove(id: string): Promise<boolean>
  /** 本地改写某条消息的反馈（供 `useChatStream` 做乐观更新与回滚，不发请求） */
  patchFeedback(messageId: string, value: FeedbackValue): void
}

/** 创建会话状态。 */
export function createThreadsStore(deps: ThreadsDeps): ThreadsStore {
  const pageSize = deps.pageSize ?? MESSAGE_PAGE_SIZE

  const list = ref<Conversation[]>([])
  const messages = ref<Message[]>([])
  const total = ref(0)
  const running = ref(false)
  const pendingInteraction = ref<InteractionSnapshot | null>(null)
  const limit = ref<HistoryLimit>(HISTORY_DEFAULT_LIMIT)
  const loading = ref(false)
  const error = ref<ErrorInfo | null>(null)

  const visible = computed(() => list.value.slice(0, limit.value))
  const hasMore = computed(() => messages.value.length < total.value)

  async function loadList(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const items = await deps.threads.list()
      // 后端已按 updated_at 倒序，前端再排一次以防契约漂移
      list.value = [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    } catch (cause) {
      error.value = toErrorInfo(cause)
    } finally {
      loading.value = false
    }
  }

  function showMore(): void {
    // 纯前端切片，不发请求（V-09）
    limit.value = HISTORY_EXPANDED_LIMIT
  }

  async function create(): Promise<void> {
    const agentName = deps.currentAgentName.value
    if (!agentName) {
      deps.toast?.push('error', '请先选择数字人')
      return
    }

    try {
      const created = await deps.threads.create(agentName)
      deps.activeThreadId.value = created.thread_id
      messages.value = []
      total.value = 0
      running.value = false
      pendingInteraction.value = null
      await loadList()
    } catch (cause) {
      // 409/404 等按场景映射文案（FR-042）
      deps.toast?.push('error', toUserMessage(toErrorInfo(cause), 'create-thread'))
    }
  }

  function clearActive(): void {
    deps.activeThreadId.value = null
    messages.value = []
    total.value = 0
    running.value = false
    pendingInteraction.value = null
  }

  async function refresh(): Promise<void> {
    const threadId = deps.activeThreadId.value
    if (!threadId) {
      clearActive()
      return
    }

    loading.value = true
    error.value = null
    try {
      const detail = await deps.threads.detail(threadId, { limit: pageSize })
      messages.value = detail.messages
      total.value = detail.total
      running.value = detail.running
      pendingInteraction.value = detail.pending_interaction
    } catch (cause) {
      error.value = toErrorInfo(cause)
    } finally {
      loading.value = false
    }
  }

  async function select(id: string): Promise<void> {
    deps.activeThreadId.value = id
    await refresh()
  }

  async function loadMore(): Promise<void> {
    const threadId = deps.activeThreadId.value
    if (!threadId || !hasMore.value) {
      return
    }

    const offset = messages.value.length
    try {
      const detail = await deps.threads.detail(threadId, { limit: pageSize, offset })
      const known = new Set(messages.value.map((message) => message.id))
      const older = detail.messages.filter((message) => !known.has(message.id))
      messages.value = [...older, ...messages.value]
      total.value = detail.total
    } catch (cause) {
      error.value = toErrorInfo(cause)
    }
  }

  /**
   * 删除会话（乐观更新）。
   *
   * `DELETE` 是终态操作，本地移除即与服务端一致，因此**先本地移除**让 UI 立即响应，
   * 请求失败再整体回滚；成功后**不再回拉列表**——少一次往返，也避免 `loading`
   * 让侧栏闪一下。返回是否删除成功，供调用方决定是否继续后续编排（如切相邻会话）。
   */
  async function remove(id: string): Promise<boolean> {
    const prevList = list.value
    const wasActive = deps.activeThreadId.value === id
    const prevMessages = messages.value
    const prevTotal = total.value
    const prevRunning = running.value

    list.value = prevList.filter((item) => item.thread_id !== id)
    if (wasActive) {
      deps.activeThreadId.value = null
      messages.value = []
      total.value = 0
      running.value = false
      pendingInteraction.value = null
    }

    try {
      await deps.threads.remove(id)
      return true
    } catch (cause) {
      // 回滚到删除前的状态，错误文案沿用统一映射
      list.value = prevList
      if (wasActive) {
        deps.activeThreadId.value = id
        messages.value = prevMessages
        total.value = prevTotal
        running.value = prevRunning
      }
      deps.toast?.push('error', toUserMessage(toErrorInfo(cause)))
      return false
    }
  }

  async function toolCallResult(callId: string): Promise<ToolCallResult> {
    const threadId = deps.activeThreadId.value
    if (!threadId) {
      // 未选中会话时不应触发懒加载（卡片只在详情渲染后才存在）
      throw new Error('未选中会话，无法读取工具结果')
    }
    return deps.threads.toolCallResult(threadId, callId)
  }

  /** 本地改写反馈：仅替换目标消息对象以触发最小范围重渲染（配合 `v-memo`）。 */
  function patchFeedback(messageId: string, value: FeedbackValue): void {
    messages.value = messages.value.map((message) =>
      message.id === messageId ? { ...message, feedback: value } : message,
    )
  }

  return {
    list,
    visible,
    activeId: deps.activeThreadId,
    messages,
    total,
    running,
    pendingInteraction,
    limit,
    loading,
    error,
    hasMore,
    loadList,
    showMore,
    create,
    select,
    loadMore,
    refresh,
    toolCallResult,
    clearActive,
    remove,
    patchFeedback,
  }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useThreads(): ThreadsStore {
  return useSession().threads
}
