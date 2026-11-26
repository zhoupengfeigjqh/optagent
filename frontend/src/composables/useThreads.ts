
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { ThreadsApi } from '../api/threads'
import type {
  Conversation,
  ErrorInfo,
  FeedbackValue,
  InteractionSnapshot,
  Message,
  ThreadSource,
} from '../api/types'
import {
  HISTORY_DEFAULT_LIMIT,
  HISTORY_EXPANDED_LIMIT,
  MESSAGE_PAGE_MAX,
  MESSAGE_PAGE_SIZE,
} from '../constants/limits'
import { toErrorInfo, toUserMessage } from '../utils/error-message'
import { threadToMarkdown } from '../utils/export-thread'
import { useSession } from './useAppSession'
import type { ToastStore } from './useToast'

export type HistoryLimit = typeof HISTORY_DEFAULT_LIMIT | typeof HISTORY_EXPANDED_LIMIT

export interface ThreadsDeps {
  threads: ThreadsApi
  activeThreadId: Ref<string | null>
  currentAgentName: Readonly<Ref<string | null>>
  toast?: ToastStore
  pageSize?: number
}

export interface ThreadsStore {
  list: Readonly<Ref<Conversation[]>>
  visible: ComputedRef<Conversation[]>
  activeSource: ComputedRef<ThreadSource | null>
  activeId: Readonly<Ref<string | null>>
  messages: Readonly<Ref<Message[]>>
  total: Readonly<Ref<number>>
  running: Readonly<Ref<boolean>>
  pendingInteraction: Readonly<Ref<InteractionSnapshot | null>>
  limit: Readonly<Ref<HistoryLimit>>
  loading: Readonly<Ref<boolean>>
  error: Readonly<Ref<ErrorInfo | null>>
  hasMore: ComputedRef<boolean>
  loadList(): Promise<void>
  showMore(): void
  create(): Promise<void>
  startNew(): void
  select(id: string): Promise<void>
  loadMore(): Promise<void>
  refresh(): Promise<void>
  /**
   * 清空当前选中并回到空态（002 特性）。
   *
   * 用于"URL 恢复出的会话已被删除"的降级：静默回空态，不报错、不留残留消息。
   */
  clearActive(): void
  /** 删除会话（乐观更新）；返回是否真正删除成功（失败已自动回滚并提示） */
  remove(id: string): Promise<boolean>
  rename(id: string, title: string): Promise<boolean>
  exportMarkdown(id: string): Promise<string | null>
  /** 本地改写某条消息的反馈（供 `useChatStream` 做乐观更新与回滚，不发请求） */
  patchFeedback(messageId: string, value: FeedbackValue): void
}

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

  const activeSource = computed<ThreadSource | null>(() => {
    const activeId = deps.activeThreadId.value
    if (!activeId) return null
    return list.value.find((item) => item.thread_id === activeId)?.source ?? null
  })

  async function loadList(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const items = await deps.threads.list()
      list.value = [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    } catch (cause) {
      error.value = toErrorInfo(cause)
    } finally {
      loading.value = false
    }
  }

  function showMore(): void {
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

  function startNew(): void {
    clearActive()
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

  /**
   * 重命名会话（乐观更新）。
   *
   * 标题是**纯展示字段**，本地改写即与服务端一致，故先改界面再发请求；失败整体回滚并
   * 提示（与 `remove` 同口径，都是"终态式"的本地先行）。空标题或未改动一律不发请求——
   * 用户在行内编辑框里敲了个空格又回车，不该产生一次 PATCH。
   */
  async function rename(threadId: string, title: string): Promise<boolean> {
    const next = title.trim()
    const prevList = list.value
    const target = prevList.find((item) => item.thread_id === threadId)
    if (!target || next === '' || target.title === next) return true

    list.value = prevList.map((item) =>
      item.thread_id === threadId ? { ...item, title: next } : item,
    )
    try {
      await deps.threads.rename(threadId, next)
      return true
    } catch (cause) {
      list.value = prevList
      deps.toast?.push('error', toUserMessage(toErrorInfo(cause)))
      return false
    }
  }

  async function fetchAllMessages(threadId: string): Promise<Message[]> {
    const pages: Message[][] = []
    let offset = 0
    for (;;) {
      const detail = await deps.threads.detail(threadId, { limit: MESSAGE_PAGE_MAX, offset })
      pages.push(detail.messages)
      offset += detail.messages.length
      // 空页 = 后端没更多了（`total` 与实际条数不一致时的兜底，避免死循环）
      if (detail.messages.length === 0 || offset >= detail.total) break
    }
    return pages.reverse().flat()
  }

  async function exportMarkdown(threadId: string): Promise<string | null> {
    const thread = list.value.find((item) => item.thread_id === threadId)
    if (!thread) return null
    try {
      return threadToMarkdown(thread, await fetchAllMessages(threadId))
    } catch (cause) {
      deps.toast?.push('error', toUserMessage(toErrorInfo(cause)))
      return null
    }
  }

  function patchFeedback(messageId: string, value: FeedbackValue): void {
    messages.value = messages.value.map((message) =>
      message.id === messageId ? { ...message, feedback: value } : message,
    )
  }

  return {
    list,
    visible,
    activeSource,
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
    startNew,
    select,
    loadMore,
    refresh,
    clearActive,
    remove,
    rename,
    exportMarkdown,
    patchFeedback,
  }
}

export function useThreads(): ThreadsStore {
  return useSession().threads
}
