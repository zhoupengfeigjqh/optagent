<script setup lang="ts">
/**
 * 消息气泡（T039）
 *
 * 装配 `MessageContent` / `ThinkingBlock` / `ToolCallBadge`，流式期间渲染 `TypingIndicator`。
 *
 * **思考与工具经 `streaming` prop 传入**：`Message` 类型从契约层面不含这两类字段（V-04），
 * 因此本轮瞬态信息只能由 `useChatStream` 提供、经 `MessageList` 逐层下传。
 *
 * 操作区（用量 / 复制 / 点赞点踩）由 T045 接入 `MessageActions`；本组件已按契约预留
 * `feedback` / `copy` 事件出口。
 */
import { computed } from 'vue'

import type { ErrorInfo, FileReference, Message } from '../../api/types'
import { MESSAGE_ROLE, MESSAGE_STATUS, RUN_PHASE, type RunPhase } from '../../constants/events'
import { formatTimestamp } from '../../utils/format'
import { countMatches } from '../../utils/segments'
import ErrorNotice from '../common/ErrorNotice.vue'
import MessageActions from './MessageActions.vue'
import MessageContent from './MessageContent.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolCallBadge from './ToolCallBadge.vue'
import TypingIndicator from './TypingIndicator.vue'

interface ToolCallView {
  call_id: string
  name: string
  status: 'running' | 'success' | 'error'
}

/** 本轮瞬态（不落历史）：思考、工具、阶段与错误。 */
interface StreamingView {
  phase: RunPhase
  text: string
  thinking: string
  toolCalls: ToolCallView[]
  error: ErrorInfo | null
  /** 本轮回答的数字人（会话可跨数字人） */
  agentName: string | null
}

const props = withDefaults(
  defineProps<{
    /** 消息（流式气泡传入以累积正文构造的合成消息） */
    message: Message
    /** 搜索关键词 */
    searchKeyword?: string
    /** 当前定位的全局匹配序号 */
    activeMatchIndex?: number
    /** 本消息内首个命中的全局序号 */
    matchIndexBase?: number
    /** 本轮瞬态；`null` 表示非流式气泡 */
    streaming?: StreamingView | null
  }>(),
  { searchKeyword: '', activeMatchIndex: -1, matchIndexBase: 0, streaming: null },
)

const emit = defineEmits<{
  /** T045 接入操作区后由 MessageActions 触发 */
  feedback: [payload: { message_id: string; value: 'up' | 'down' | null }]
  /** T045 接入操作区后由 MessageActions 触发 */
  copy: [message_id: string]
  /** 失败轮重试入口 */
  retry: []
  /** 外部地址点击：由上层直跳新窗口，不进预览区（V-10） */
  'open-link': [href: string]
  /** 空间目录文件点击：由上层打开右侧内联预览（FR-046） */
  'open-file': [reference: FileReference]
}>()

const isUser = computed(() => props.message.role === MESSAGE_ROLE.USER)
/**
 * 本条消息所属数字人：已落盘消息取 `message.agent_name`（后端逐条返回），
 * 流式气泡取本轮快照。会话可跨数字人（FR-014 修订），因此逐条标注而非按会话标注。
 */
const agentName = computed(
  () => props.message.agent_name ?? props.streaming?.agentName ?? null,
)
const roleLabel = computed(() => {
  if (isUser.value) return '我'
  return agentName.value ? `${agentName.value} · 助手` : '助手'
})
const formattedTime = computed(() => formatTimestamp(props.message.ts))
const attachments = computed(() => props.message.attachments ?? [])

const thinkingText = computed(() => props.streaming?.thinking ?? '')
const toolCalls = computed(() => props.streaming?.toolCalls ?? [])
const isStreaming = computed(() => props.streaming?.phase === RUN_PHASE.STREAMING)

const showThinking = computed(() => thinkingText.value.trim() !== '')
const showTyping = computed(() => isStreaming.value && props.message.content === '')

/**
 * 只处理**已落盘的失败轮**（`status === 'failed'`）。
 * 流式过程中的断连由 `ChatPanel` 统一提示"重新获取"（FR-049），避免两处重复告警。
 */
const errorInfo = computed<ErrorInfo | null>(() => props.message.error ?? null)
const showError = computed(
  () => props.message.status === MESSAGE_STATUS.FAILED && errorInfo.value !== null,
)

/** V-07：仅 `completed` 且已落盘（有 id）的消息才进入可操作态。 */
const isActionable = computed(
  () => props.message.status === MESSAGE_STATUS.COMPLETED && props.message.id !== '',
)

const stateClass = computed(() => {
  if (props.message.status === MESSAGE_STATUS.FAILED) {
    return 'message-bubble--failed'
  }
  return isActionable.value ? 'message-bubble--completed' : 'message-bubble--pending'
})

/** 同值重复点击 = 取消（V-08）：向父级提交 `null`。 */
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

    <!-- 引用由 attachments 还原（不依赖 content 文本）；点击打开右侧内联预览（FR-046） -->
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

    <div v-if="toolCalls.length" class="message-bubble__tools">
      <ToolCallBadge
        v-for="call in toolCalls"
        :key="call.call_id"
        :name="call.name"
        :status="call.status"
      />
    </div>

    <MessageContent
      :content="message.content"
      :keyword="searchKeyword"
      :match-index-base="matchIndexBase"
      @open-link="emit('open-link', $event)"
    />

    <TypingIndicator v-if="showTyping" />

    <ErrorNotice v-if="showError && errorInfo" :error="errorInfo" @retry="emit('retry')" />

    <!-- 仅 completed 且已落盘的消息展示操作与用量（V-07 / FR-028） -->
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
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
