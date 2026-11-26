<script setup lang="ts">
import { computed } from 'vue'

import type { ErrorInfo, FileReference, Message, NextStepAction } from '../../api/types'
import type { ThreadNextSteps } from '../../api/threads'
import { MESSAGE_ROLE, MESSAGE_STATUS, RUN_PHASE } from '../../constants/events'
import { formatTimestamp } from '../../utils/format'
import { visibleActions } from '../../utils/next-steps'
import { countMatches } from '../../utils/segments'
import {
  collectToolViewLinks,
  streamingToolCallItem,
  toolCallItemsOf,
} from '../../utils/tool-calls'
import type { ViewLinkTarget } from '../../utils/view-link'
import ErrorNotice from '../common/ErrorNotice.vue'
import MessageActions from './MessageActions.vue'
import MessageContent from './MessageContent.vue'
import MessageNextSteps from './MessageNextSteps.vue'
import MessageViewLinks from './MessageViewLinks.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolCallList from './ToolCallList.vue'
import TypingIndicator from './TypingIndicator.vue'
import type { StreamSegmentView, StreamingView } from './types'

const props = withDefaults(
  defineProps<{
    message: Message
    searchKeyword?: string
    activeMatchIndex?: number
    matchIndexBase?: number
    streaming?: StreamingView | null
    nextSteps?: ThreadNextSteps | null
    retryLabel?: string | null
  }>(),
  {
    searchKeyword: '',
    activeMatchIndex: -1,
    matchIndexBase: 0,
    streaming: null,
    nextSteps: null,
    retryLabel: '重试本轮',
  },
)

const emit = defineEmits<{
  feedback: [payload: { message_id: string; value: 'up' | 'down' | null }]
  copy: [message_id: string]
  retry: []
  regenerate: []
  'open-link': [href: string]
  'open-file': [reference: FileReference]
  'open-view': [item: ViewLinkTarget]
  'send-suggestion': [action: NextStepAction]
}>()

const isUser = computed(() => props.message.role === MESSAGE_ROLE.USER)
const agentName = computed(() => props.message.agent_name ?? props.streaming?.agentName ?? null)
const roleLabel = computed(() => {
  if (isUser.value) return '我'
  return agentName.value ? `${agentName.value} · 助手` : '助手'
})
const formattedTime = computed(() => formatTimestamp(props.message.ts))
const attachments = computed(() => props.message.attachments ?? [])
const skill = computed(() => props.message.skill ?? '')

const thinkingText = computed(() => props.streaming?.thinking ?? '')
const toolItems = computed(() =>
  props.streaming
    ? props.streaming.toolCalls.map(streamingToolCallItem)
    : toolCallItemsOf(props.message),
)
const viewLinks = computed(() => collectToolViewLinks(toolItems.value))
/**
 * 本条回答下方的下一步动作卡片（007）：只有"最新一轮"（快照归属的消息）才非空。
 * 流式气泡的 id 为空串，天然不可能命中，故流式期间不会出现卡片。
 */
const nextActions = computed(() => visibleActions(props.nextSteps ?? null, props.message.id))
const isStreaming = computed(() => props.streaming?.phase === RUN_PHASE.STREAMING)
const isAborted = computed(() => props.streaming?.phase === RUN_PHASE.ABORTED)

const showThinking = computed(() => thinkingText.value.trim() !== '')
const runningToolNames = computed(() => {
  if (!isStreaming.value) {
    return []
  }
  const seen = new Set<string>()
  const names: string[] = []
  for (const item of props.streaming?.toolCalls ?? []) {
    if (item.status !== 'running') {
      continue
    }
    const name = item.label ?? item.name
    if (name === '' || seen.has(name)) {
      continue
    }
    seen.add(name)
    names.push(name)
  }
  return names
})
const typingLabel = computed(() => {
  const names = runningToolNames.value
  const first = names[0]
  if (names.length === 1 && first !== undefined) {
    return `正在执行 ${first}…`
  }
  if (names.length > 1) {
    return `正在执行 ${names.length} 个工具…`
  }
  // 措辞说"模型"而不是"工具"，因为实测静默主要发生在 LLM 侧，工具执行期有上面的分支。
  if (props.streaming?.stalled === true) {
    return '模型正在思考…'
  }
  // 两档都必须有，因为提示本身是**常驻**的（见 `showTyping`），文案不能停在一个会误导的说法上。
  return props.message.content === '' ? '思考中' : '正在生成…'
})
const showTyping = computed(() => isStreaming.value)

const streamSegments = computed<StreamSegmentView[]>(() => {
  if (!isStreaming.value) {
    return []
  }
  return props.streaming?.segments ?? []
})

/**
 * 只处理**已落盘的失败轮**（`status === 'failed'`）。
 * 本轮（刚失败、尚未落盘到列表）的提示由 `ChatPanel` 统一负责——TR-58 分流：
 * 可重发时「重试本轮」，否则「重新获取」；两处各管一段生命周期，避免重复告警。
 */
const errorInfo = computed<ErrorInfo | null>(() => props.message.error ?? null)
const showError = computed(
  () => props.message.status === MESSAGE_STATUS.FAILED && errorInfo.value !== null,
)

const isActionable = computed(
  () => props.message.status === MESSAGE_STATUS.COMPLETED && props.message.id !== '',
)

const stateClass = computed(() => {
  if (props.message.status === MESSAGE_STATUS.FAILED) {
    return 'message-bubble--failed'
  }
  return isActionable.value ? 'message-bubble--completed' : 'message-bubble--pending'
})

function onFeedback(value: 'up' | 'down'): void {
  emit('feedback', {
    message_id: props.message.id,
    value: props.message.feedback === value ? null : value,
  })
}

function onCopy(): void {
  emit('copy', props.message.id)
}

const containsActiveMatch = computed(() => {
  if (props.activeMatchIndex < 0) {
    return false
  }
  const total = countMatches(props.message.content, props.searchKeyword)
  return (
    props.activeMatchIndex >= props.matchIndexBase &&
    props.activeMatchIndex < props.matchIndexBase + total
  )
})
</script>

<template>
  <article
    class="message-bubble"
    :class="[
      isUser ? 'message-bubble--user' : 'message-bubble--assistant',
      stateClass,
      { 'message-bubble--search-active': containsActiveMatch },
    ]"
  >
    <header class="message-bubble__head">
      <span class="message-bubble__role">{{ roleLabel }}</span>
      <time class="message-bubble__time">{{ formattedTime }}</time>
    </header>

    <p v-if="skill" class="message-bubble__skill">/{{ skill }}</p>

    <ul v-if="attachments.length" class="message-bubble__refs">
      <li v-for="reference in attachments" :key="`${reference.dir}/${reference.filename}`">
        <button
          type="button"
          class="message-bubble__ref"
          :title="`预览 ${reference.filename}`"
          @click="emit('open-file', reference)"
        >
          @{{ reference.filename }}
        </button>
      </li>
    </ul>

    <ThinkingBlock v-if="showThinking" :text="thinkingText" :streaming="isStreaming" />

    <template v-if="streamSegments.length > 0">
      <template v-for="(segment, index) in streamSegments" :key="index">
        <ToolCallList
          v-if="segment.kind === 'tool'"
          class="message-bubble__tools"
          :items="[streamingToolCallItem(segment.call)]"
          :live="true"
          :hide-head="true"
          @open-view="emit('open-view', $event)"
        />
        <MessageContent v-else :content="segment.text" @open-link="emit('open-link', $event)" />
      </template>
    </template>

    <template v-else>
      <ToolCallList
        v-if="toolItems.length"
        class="message-bubble__tools"
        :items="toolItems"
        :live="isStreaming"
        @open-view="emit('open-view', $event)"
      />

      <MessageContent
        :content="message.content"
        :keyword="searchKeyword"
        :match-index-base="matchIndexBase"
        @open-link="emit('open-link', $event)"
      />
    </template>

    <MessageViewLinks :links="viewLinks" @open-view="emit('open-view', $event)" />

    <MessageNextSteps
      :actions="nextActions"
      :disabled="isStreaming"
      @select="emit('send-suggestion', $event)"
    />

    <TypingIndicator v-if="showTyping" :label="typingLabel" />

    <ErrorNotice
      v-if="showError && errorInfo"
      :error="errorInfo"
      :retry-label="retryLabel"
      @retry="emit('retry')"
    />

    <div v-if="isAborted" class="message-bubble__aborted">
      <span class="message-bubble__aborted-hint">已停止生成 · 内容未保存</span>
      <button
        v-if="streaming?.canRegenerate"
        type="button"
        class="message-bubble__regenerate"
        @click="emit('regenerate')"
      >
        重新生成
      </button>
    </div>

    <MessageActions
      v-if="isActionable"
      class="message-bubble__actions"
      :usage="message.usage ?? null"
      :duration-seconds="message.duration_seconds ?? null"
      :feedback="message.feedback"
      :copy-text="message.content"
      @copy="onCopy"
      @feedback="onFeedback"
    />
  </article>
</template>

<style scoped>
.message-bubble {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}

.message-bubble--user {
  align-self: flex-end;
  max-width: 80%;
  background: var(--color-primary-subtle);
}

.message-bubble--search-active {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.message-bubble__head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.message-bubble__role {
  font-weight: 600;
}

.message-bubble__skill {
  align-self: flex-start;
  margin: 0;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-bg-muted);
  color: var(--color-text);
  font-size: var(--font-size-sm);
}

.message-bubble__refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.message-bubble__ref {
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  color: var(--color-primary);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.message-bubble__ref:hover {
  background: var(--color-primary-subtle);
}

.message-bubble__tools {
  display: block;
}

.message-bubble__aborted {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--font-size-sm);
}

.message-bubble__aborted-hint {
  color: var(--color-text-muted);
}

.message-bubble__regenerate {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-primary);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.message-bubble__regenerate:hover {
  background: var(--color-primary-subtle);
}
</style>
