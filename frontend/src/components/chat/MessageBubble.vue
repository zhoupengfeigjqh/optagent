<script setup lang="ts">
/**
 * 消息气泡（T039）
 *
 * 装配 `MessageContent` / `ThinkingBlock` / `ToolCallList`，流式期间渲染 `TypingIndicator`。
 *
 * **思考经 `streaming` prop 传入**：`Message` 类型从契约层面不含思考内容（V-04），
 * 因此本轮瞬态信息只能由 `useChatStream` 提供、经 `MessageList` 逐层下传。
 * **工具调用则两侧都有**（002 特性）：流式轮次取瞬态、历史轮次取 `message.tool_calls`，
 * 二者统一成 `ToolCallItem` 交给同一个卡片组件。
 *
 * 操作区（用量 / 复制 / 点赞点踩）由 T045 接入 `MessageActions`；本组件已按契约预留
 * `feedback` / `copy` 事件出口。
 */
import { computed } from 'vue'

import type { ErrorInfo, FileReference, Message, ToolCallResult } from '../../api/types'
import { MESSAGE_ROLE, MESSAGE_STATUS, RUN_PHASE, type RunPhase } from '../../constants/events'
import { formatTimestamp } from '../../utils/format'
import { countMatches } from '../../utils/segments'
import { streamingToolCallItem, toolCallItemsOf } from '../../utils/tool-calls'
import ErrorNotice from '../common/ErrorNotice.vue'
import MessageActions from './MessageActions.vue'
import MessageContent from './MessageContent.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolCallList from './ToolCallList.vue'
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
  /** ABORTED 态是否有可重发的中断轮缓存（「重新生成」按钮渲染条件） */
  canRegenerate?: boolean
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
    /**
     * 工具卡片懒加载外置结果正文（002 特性）；仅历史气泡使用。
     * 缺省时卡片只展示随详情下发的内联内容与摘要。
     */
    loadToolResult?: ((callId: string) => Promise<ToolCallResult>) | undefined
  }>(),
  {
    searchKeyword: '',
    activeMatchIndex: -1,
    matchIndexBase: 0,
    streaming: null,
    loadToolResult: undefined,
  },
)

const emit = defineEmits<{
  /** T045 接入操作区后由 MessageActions 触发 */
  feedback: [payload: { message_id: string; value: 'up' | 'down' | null }]
  /** T045 接入操作区后由 MessageActions 触发 */
  copy: [message_id: string]
  /** 失败轮重试入口 */
  retry: []
  /** 中断轮「重新生成」：以缓存的上一条用户消息重发一轮 */
  regenerate: []
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
/**
 * 工具卡片数据（002 特性）：一个组件服务两种来源。
 * - 流式轮次：`streaming.toolCalls`（SSE 仅给名称与状态，结果尚未产生）
 * - 历史消息：`message.tool_calls`（落盘记录，含内联结果或外置引用）
 */
const toolItems = computed(() =>
  props.streaming
    ? props.streaming.toolCalls.map(streamingToolCallItem)
    : toolCallItemsOf(props.message),
)
/** 外置正文只存在于历史记录，流式轮次不触发懒加载 */
const toolLoader = computed(() => (props.streaming ? undefined : props.loadToolResult))
const isStreaming = computed(() => props.streaming?.phase === RUN_PHASE.STREAMING)
/** 中断轮：保留 partial 正文，但须明确标识"已停止"，与正常回答区分 */
const isAborted = computed(() => props.streaming?.phase === RUN_PHASE.ABORTED)

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

    <!-- 工具调用卡片（002 特性）：流式态与历史态共用一个组件 -->
    <ToolCallList
      v-if="toolItems.length"
      class="message-bubble__tools"
      :items="toolItems"
      :load-result="toolLoader"
    />

    <MessageContent
      :content="message.content"
      :keyword="searchKeyword"
      :match-index-base="matchIndexBase"
      @open-link="emit('open-link', $event)"
    />

    <TypingIndicator v-if="showTyping" />

    <ErrorNotice v-if="showError && errorInfo" :error="errorInfo" @retry="emit('retry')" />

    <!-- 中断轮标识（流式气泡专属）：partial 内容非完整回答；可重发时给「重新生成」 -->
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
  /* 工具卡片列表自带纵向布局，此处只作为外层挂点 */
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
