<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import type { FileReference, Message, NextStepAction, ThreadSource } from '../../api/types'
import type { ThreadNextSteps } from '../../api/threads'
import { MESSAGE_ROLE, MESSAGE_STATUS, RUN_PHASE } from '../../constants/events'
import type { PendingUserMessage } from '../../composables/useChatStream'
import { useMessageScroll } from '../../composables/useMessageScroll'
import { countMatches } from '../../utils/segments'
import type { ViewLinkTarget } from '../../utils/view-link'
import BaseIcon from '../common/BaseIcon.vue'
import EmptyState from '../common/EmptyState.vue'
import ThreadSourceNotice from '../schedule/ThreadSourceNotice.vue'
import MessageBubble from './MessageBubble.vue'
import type { StreamingView } from './types'

const props = withDefaults(
  defineProps<{
    messages?: Message[]
    streaming?: StreamingView | null
    pendingUser?: PendingUserMessage | null
    searchKeyword?: string
    activeMatchIndex?: number
    hasMore?: boolean
    nextSteps?: ThreadNextSteps | null
    threadId?: string | null
    source?: ThreadSource | null
  }>(),
  {
    messages: () => [],
    streaming: null,
    pendingUser: null,
    searchKeyword: '',
    activeMatchIndex: -1,
    hasMore: false,
    nextSteps: null,
    threadId: null,
    source: null,
  },
)

const emit = defineEmits<{
  'load-more': []
  feedback: [payload: { message_id: string; value: 'up' | 'down' | null }]
  retry: [payload: { content: string; attachments: FileReference[] }]
  regenerate: []
  'open-link': [href: string]
  'open-file': [reference: FileReference]
  'open-view': [item: ViewLinkTarget]
  'send-suggestion': [action: NextStepAction]
}>()

const listRef = ref<HTMLElement | null>(null)

const isEmpty = computed(
  () => props.messages.length === 0 && props.streaming === null && props.pendingUser === null,
)

const nextStepsId = computed(() => props.nextSteps?.message_id ?? '')


const RETRY_LABEL = '重试本轮'

function retryTurnOf(index: number): { content: string; attachments: FileReference[] } | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const message = props.messages[i]
    if (message && message.role === MESSAGE_ROLE.USER) {
      return { content: message.content, attachments: message.attachments ?? [] }
    }
  }
  return null
}

const retryLabels = computed<(string | null)[]>(() =>
  props.messages.map((message, index) =>
    message.status === MESSAGE_STATUS.FAILED && retryTurnOf(index) ? RETRY_LABEL : null,
  ),
)

function onRetry(index: number): void {
  const turn = retryTurnOf(index)
  if (turn) {
    emit('retry', turn)
  }
}

const matchStats = computed(() => {
  const bases: number[] = []
  let cursor = 0
  for (const message of props.messages) {
    bases.push(cursor)
    cursor += countMatches(message.content, props.searchKeyword)
  }
  return { bases, total: cursor }
})

const pendingUserMessage = computed<Message | null>(() => {
  const pending = props.pendingUser
  if (!pending) {
    return null
  }
  return {
    id: '',
    role: 'user',
    content: pending.content,
    ts: '',
    feedback: null,
    attachments: pending.attachments,
    ...(pending.skill ? { skill: pending.skill } : {}),
  }
})

const streamingMessage = computed<Message | null>(() => {
  const run = props.streaming
  if (!run || run.phase === RUN_PHASE.IDLE) {
    return null
  }
  if (run.phase === RUN_PHASE.FAILED && run.text === '') {
    return null
  }
  return {
    id: '',
    role: 'assistant',
    content: run.text,
    ts: '',
    feedback: null,
    ...(run.agentName ? { agent_name: run.agentName } : {}),
  }
})

function markActiveMatch(index: number): void {
  const root = listRef.value
  if (!root) {
    return
  }
  for (const element of root.querySelectorAll('[data-active-match="true"]')) {
    element.removeAttribute('data-active-match')
  }
  if (index < 0) {
    return
  }
  const target = root.querySelector(`[data-match-index="${index}"]`)
  if (target instanceof HTMLElement) {
    target.setAttribute('data-active-match', 'true')
    target.scrollIntoView?.({ block: 'center' })
  }
}

watch(
  () => props.activeMatchIndex,
  (index) => {
    void nextTick(() => markActiveMatch(index))
  },
  { immediate: true },
)


const { atBottom, announcement, onScroll, scrollToLatest } = useMessageScroll({
  listRef,
  messages: computed(() => props.messages),
  streamKey: computed(
    () =>
      `${props.streaming?.phase ?? ''}|${props.streaming?.text.length ?? 0}|${
        props.streaming?.thinking.length ?? 0
      }|${props.streaming?.toolCalls.length ?? 0}`,
  ),
  pendingUser: computed(() => props.pendingUser),
  threadId: computed(() => props.threadId),
})

function onFeedback(payload: { message_id: string; value: 'up' | 'down' | null }): void {
  emit('feedback', payload)
}

function onOpenLink(href: string): void {
  emit('open-link', href)
}

function onOpenFile(reference: FileReference): void {
  emit('open-file', reference)
}

function onOpenView(item: ViewLinkTarget): void {
  emit('open-view', item)
}
function nextStepsOf(message: Message): ThreadNextSteps | null {
  return props.nextSteps && props.nextSteps.message_id === message.id ? props.nextSteps : null
}
</script>

<template>
  <div class="message-list-wrap">
    <div
      ref="listRef"
      class="message-list"
      role="log"
      aria-label="对话消息"
      aria-live="off"
      @scroll="onScroll"
    >
      <ThreadSourceNotice v-if="source" :source="source" />

      <button v-if="hasMore" type="button" class="message-list__more" @click="emit('load-more')">
        加载更早的消息
      </button>

      <slot v-if="isEmpty" name="empty">
        <EmptyState title="还没有消息" description="在下方输入框发送第一条消息开始对话" />
      </slot>

      <template v-else>
        <MessageBubble
          v-for="(message, index) in messages"
          :key="message.id"
          v-memo="[
            message,
            searchKeyword,
            activeMatchIndex,
            matchStats.bases[index],
            nextStepsId,
            retryLabels[index],
          ]"
          :message="message"
          :search-keyword="searchKeyword"
          :active-match-index="activeMatchIndex"
          :match-index-base="matchStats.bases[index]"
          :next-steps="nextStepsOf(message)"
          :retry-label="retryLabels[index]"
          @feedback="onFeedback"
          @retry="onRetry(index)"
          @open-link="onOpenLink"
          @open-file="onOpenFile"
          @open-view="onOpenView"
          @send-suggestion="emit('send-suggestion', $event)"
        />

        <MessageBubble
          v-if="pendingUserMessage"
          :key="'pending-user'"
          :message="pendingUserMessage"
          :search-keyword="searchKeyword"
          :active-match-index="activeMatchIndex"
          :match-index-base="matchStats.total"
          @open-link="onOpenLink"
          @open-file="onOpenFile"
        />

        <MessageBubble
          v-if="streamingMessage"
          :key="'streaming'"
          :message="streamingMessage"
          :streaming="streaming"
          aria-live="off"
          :search-keyword="searchKeyword"
          :active-match-index="activeMatchIndex"
          :match-index-base="matchStats.total"
          @feedback="onFeedback"
          @regenerate="emit('regenerate')"
          @open-link="onOpenLink"
          @open-file="onOpenFile"
        />
      </template>
    </div>

    <p
      class="message-list__announce"
      data-test="message-list-announce"
      role="status"
      aria-live="polite"
    >
      {{ announcement }}
    </p>

    <button
      v-if="!atBottom"
      type="button"
      class="message-list__jump"
      data-test="message-list-jump"
      aria-label="回到底部"
      title="回到底部"
      @click="scrollToLatest"
    >
      <BaseIcon name="chevron-down" :size="18" />
    </button>
  </div>
</template>

<style scoped>
.message-list-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.message-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  overflow-y: auto;
}

.message-list__jump {
  position: absolute;
  right: var(--space-5);
  bottom: var(--space-2);
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface-raised);
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
}

.message-list__jump:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

/*
 * 读屏专用播报区：视觉上不可见，但**不能**用 `display: none` / `visibility: hidden`
 * （那会让辅助技术也看不到，播报直接失效）。用 1px 裁剪的标准做法。
 */
.message-list__announce {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.message-list__more {
  align-self: center;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
</style>
