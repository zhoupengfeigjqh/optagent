/**
 * 会话内搜索（FR-029、FR-030、SC-009）
 *
 * 匹配语义与 `utils/segments.ts` 的**高亮口径完全一致**（同一 `countMatches` 实现），
 * 否则会出现"高亮了但跳不过去"的不一致。
 *
 * 定位策略：`next()` = `(activeIndex + 1) % total`，到达末尾循环回首项。
 * 命中大量结果时不一次性滚动渲染——`MessageList` 仅对当前活跃序号滚动定位。
 */

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

import type { Message } from '../api/types'
import { countMatches } from '../utils/segments'
import { useSession } from './useAppSession'

/** 单条匹配：消息 id + 全局序号。 */
export interface SearchMatch {
  messageId: string
  index: number
}

/** 构造参数。 */
export interface SearchDeps {
  /** 当前会话消息（按时间正序），以取值函数传入以便跟随会话切换 */
  messages: () => readonly Message[]
}

/** 搜索 composable 契约。 */
export interface SessionSearchStore {
  isOpen: Ref<boolean>
  keyword: Ref<string>
  matches: ComputedRef<SearchMatch[]>
  /** 每条消息内首个命中的全局序号（供 `MessageBubble.matchIndexBase`） */
  baseOf: ComputedRef<Map<string, number>>
  activeIndex: Readonly<Ref<number>>
  total: ComputedRef<number>
  /** 当前定位的消息 id（供列表滚动定位） */
  activeMessageId: ComputedRef<string | null>
  open(): void
  next(): void
  close(): void
}

/** 创建会话内搜索状态。 */
export function createSessionSearchStore(deps: SearchDeps): SessionSearchStore {
  const isOpen = ref(false)
  const keyword = ref('')
  const activeIndex = ref(-1)

  const matches = computed<SearchMatch[]>(() => {
    const trimmed = keyword.value.trim()
    if (trimmed === '') {
      return []
    }

    const result: SearchMatch[] = []
    let cursor = 0
    for (const message of deps.messages()) {
      const count = countMatches(message.content, trimmed)
      for (let offset = 0; offset < count; offset += 1) {
        result.push({ messageId: message.id, index: cursor + offset })
      }
      cursor += count
    }
    return result
  })

  const total = computed(() => matches.value.length)

  const baseOf = computed(() => {
    const map = new Map<string, number>()
    for (const match of matches.value) {
      if (!map.has(match.messageId)) {
        map.set(match.messageId, match.index)
      }
    }
    return map
  })

  const activeMessageId = computed(() => {
    const index = activeIndex.value
    if (index < 0 || index >= matches.value.length) {
      return null
    }
    return matches.value[index].messageId
  })

  // 关键词变化 → 首次定位到第一个命中（US8 场景 2）
  watch(keyword, () => {
    activeIndex.value = matches.value.length > 0 ? 0 : -1
  })

  function open(): void {
    isOpen.value = true
  }

  function next(): void {
    const count = matches.value.length
    if (count === 0) {
      activeIndex.value = -1
      return
    }
    activeIndex.value = (activeIndex.value + 1) % count
  }

  function close(): void {
    isOpen.value = false
    keyword.value = ''
    activeIndex.value = -1
  }

  return {
    isOpen,
    keyword,
    matches,
    baseOf,
    activeIndex,
    total,
    activeMessageId,
    open,
    next,
    close,
  }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useSessionSearch(): SessionSearchStore {
  return useSession().search
}
