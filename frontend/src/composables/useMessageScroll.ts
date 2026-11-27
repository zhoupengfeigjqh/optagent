import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

import type { Message } from '../api/types'
import { MESSAGE_ROLE, MESSAGE_STATUS } from '../constants/events'

const STICK_THRESHOLD_PX = 80

/** 存档上限：与草稿分桶同口径，逛过很多会话也不无限增长 */
const SCROLL_MEMORY_LIMIT = 50

export interface MessageScrollOptions {
  listRef: Ref<HTMLElement | null>
  messages: Ref<Message[]>
  streamKey: Ref<string>
  pendingUser: Ref<unknown | null>
  threadId: Ref<string | null>
}

export interface MessageScroll {
  atBottom: Ref<boolean>
  announcement: Ref<string>
  onScroll(): void
  scrollToLatest(): void
}

export function useMessageScroll(options: MessageScrollOptions): MessageScroll {
  const { listRef, messages, streamKey, pendingUser, threadId } = options

  const atBottom = ref(true)
  const announcement = ref('')

  const firstId = computed(() => messages.value[0]?.id ?? '')
  const lastId = computed(() => messages.value[messages.value.length - 1]?.id ?? '')

  function isNearBottom(): boolean {
    const element = listRef.value
    if (!element) return true
    return element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_THRESHOLD_PX
  }

  function scrollToLatest(): void {
    const element = listRef.value
    if (!element) return
    element.scrollTop = element.scrollHeight
    atBottom.value = true
  }

  function onScroll(): void {
    atBottom.value = isNearBottom()
  }

  const scrollMemory = new Map<string, number>()
  let currentThreadId: string | null = threadId.value

  /** 给离开的会话存档；贴底离开则清掉旧档（避免"贴底走、上翻回"的错觉） */
  function rememberScroll(id: string | null): void {
    if (id === null) return
    const element = listRef.value
    if (atBottom.value || !element) {
      scrollMemory.delete(id)
      return
    }
    scrollMemory.delete(id)
    scrollMemory.set(id, element.scrollTop)
    while (scrollMemory.size > SCROLL_MEMORY_LIMIT) {
      const oldest = scrollMemory.keys().next().value
      if (oldest === undefined) break
      scrollMemory.delete(oldest)
    }
  }

  function restoreScroll(scrollTop: number): void {
    atBottom.value = false
    void nextTick(() => {
      const element = listRef.value
      if (!element) return
      element.scrollTop = scrollTop
      atBottom.value = isNearBottom()
    })
  }

  function announceCompleted(latest: Message): void {
    if (latest.role !== MESSAGE_ROLE.ASSISTANT) return
    if (latest.status === MESSAGE_STATUS.FAILED) return
    announcement.value = `回答已完成，共 ${latest.content.length} 字`
  }

  // 基线取自首帧，否则首次变化会被误判为"首条也变了"（会话切换）
  let previousFirst = firstId.value
  let previousLast = lastId.value
  let previousCount = messages.value.length

  watch(
    () => [firstId.value, lastId.value, messages.value.length] as const,
    ([first, last, count]) => {
      const firstChanged = first !== previousFirst
      const lastChanged = last !== previousLast
      const grew = count > previousCount
      previousFirst = first
      previousLast = last
      previousCount = count

      if (firstChanged && !lastChanged && grew) {
        const before = listRef.value?.scrollHeight ?? 0
        void nextTick(() => {
          const element = listRef.value
          if (element) element.scrollTop += element.scrollHeight - before
        })
        return
      }

      if (firstChanged) {
        rememberScroll(currentThreadId)
        currentThreadId = threadId.value
        const saved = threadId.value === null ? undefined : scrollMemory.get(threadId.value)
        if (saved === undefined) {
          atBottom.value = true
          void nextTick(scrollToLatest)
        } else {
          restoreScroll(saved)
        }
        return
      }

      if (lastChanged) {
        if (atBottom.value) void nextTick(scrollToLatest)
        const latest = messages.value[messages.value.length - 1]
        if (latest) announceCompleted(latest)
      }
    },
  )

  watch(streamKey, () => {
    if (atBottom.value) void nextTick(scrollToLatest)
  })

  watch(pendingUser, (next) => {
    if (!next) return
    atBottom.value = true
    void nextTick(scrollToLatest)
  })

  let resizeObserver: ResizeObserver | null = null

  onMounted(() => {
    void nextTick(scrollToLatest)
    if (typeof ResizeObserver === 'undefined' || !listRef.value) return
    resizeObserver = new ResizeObserver(() => {
      const element = listRef.value
      if (!element) return
      if (atBottom.value) {
        element.scrollTop = element.scrollHeight
      } else {
        atBottom.value = isNearBottom()
      }
    })
    resizeObserver.observe(listRef.value)
  })

  onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
  })

  return { atBottom, announcement, onScroll, scrollToLatest }
}
