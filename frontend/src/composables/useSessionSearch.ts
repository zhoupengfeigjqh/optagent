
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

import type { Message } from '../api/types'
import { countMatches } from '../utils/segments'
import { useSession } from './useAppSession'

export interface SearchMatch {
  messageId: string
  index: number
}

export interface SearchDeps {
  messages: () => readonly Message[]
}

export interface SessionSearchStore {
  isOpen: Ref<boolean>
  keyword: Ref<string>
  matches: ComputedRef<SearchMatch[]>
  baseOf: ComputedRef<Map<string, number>>
  activeIndex: Readonly<Ref<number>>
  total: ComputedRef<number>
  activeMessageId: ComputedRef<string | null>
  open(): void
  next(): void
  close(): void
}

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

export function useSessionSearch(): SessionSearchStore {
  return useSession().search
}
