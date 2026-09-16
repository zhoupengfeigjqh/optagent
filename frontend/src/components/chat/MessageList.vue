<script setup lang="ts">
/**
 * 消息列表（T040）
 *
 * - 空消息且无流式 → 初始入口占位（`empty` 插槽可替换）
 * - 有消息 → 逐条渲染 `MessageBubble`，并用 `v-memo` 抑制无关重渲染
 * - 流式 → 追加"合成气泡"承载本轮思考/工具/正文；其**上方**先渲染乐观用户气泡
 *   （`pendingUser`，十七次调整：发送即出现，完成后由历史真身接管，不重复）
 * - 搜索 → 计算每条消息的全局匹配基准序号，并只对当前活跃序号滚动定位
 * - **自动置底**：切换会话、新消息落定、流式增量都跟随到最新；
 *   用户向上翻阅时暂停（回到近底部即恢复），"加载更早消息"只补偿高度、不跳到底部
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import type { ErrorInfo, FileReference, Message } from '../../api/types'
import { RUN_PHASE, type RunPhase } from '../../constants/events'
import type { PendingUserMessage } from '../../composables/useChatStream'
import { countMatches } from '../../utils/segments'
import EmptyState from '../common/EmptyState.vue'
import MessageBubble from './MessageBubble.vue'

interface ToolCallView {
  call_id: string
  name: string
  status: 'running' | 'success' | 'error'
}

/** 本轮瞬态（与 `MessageBubble.streaming` 同构）。 */
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
    /** 历史消息（按时间正序） */
    messages?: Message[]
    /** 本轮瞬态；`null` 表示无进行中的轮次 */
    streaming?: StreamingView | null
    /**
     * 本轮乐观用户消息（十七次调整）；`null` 表示无进行中轮次。
     * 渲染在历史消息之后、流式气泡**之前**；流终结时由调用方清除。
     */
    pendingUser?: PendingUserMessage | null
    /** 搜索关键词 */
    searchKeyword?: string
    /** 当前定位的全局匹配序号 */
    activeMatchIndex?: number
    /** 是否还有更早的历史可加载 */
    hasMore?: boolean
  }>(),
  {
    messages: () => [],
    streaming: null,
    pendingUser: null,
    searchKeyword: '',
    activeMatchIndex: -1,
    hasMore: false,
  },
)

const emit = defineEmits<{
  'load-more': []
  /** 消息反馈（契约未列该项，为向上透传的最小超集；`copy` 由 MessageActions 就地完成） */
  feedback: [payload: { message_id: string; value: 'up' | 'down' | null }]
  /** 外部地址点击（契约未列，向上透传；V-10 直跳由装配层执行） */
  'open-link': [href: string]
  /** 空间目录文件点击（契约未列，向上透传；FR-046 预览由装配层执行） */
  'open-file': [reference: FileReference]
}>()

const listRef = ref<HTMLElement | null>(null)

const isEmpty = computed(
  () =>
    props.messages.length === 0 && props.streaming === null && props.pendingUser === null,
)

/** 每条消息内首个命中的全局序号（与 `useSessionSearch` 同口径）。 */
const matchStats = computed(() => {
  const bases: number[] = []
  let cursor = 0
  for (const message of props.messages) {
    bases.push(cursor)
    cursor += countMatches(message.content, props.searchKeyword)
  }
  return { bases, total: cursor }
})

/** 乐观用户气泡：合成一条 `Message` 交给 `MessageBubble`，引用经 `attachments` 还原。 */
const pendingUserMessage = computed<Message | null>(() => {
  const pending = props.pendingUser
  if (!pending) {
    return null
  }
  return {
    // 瞬态消息无持久化 id：占位串仅作 `key`/内部标识，不触发任何按 id 的操作
    //（用户气泡不渲染反馈按钮，与 `streamingMessage` 的空 id 同口径）
    id: '',
    role: 'user',
    content: pending.content,
    ts: '',
    feedback: null,
    attachments: pending.attachments,
  }
})

/** 流式气泡：`content` 为本轮累积正文，瞬态经 `streaming` 传入。 */
const streamingMessage = computed<Message | null>(() => {
  const run = props.streaming
  if (!run || run.phase === RUN_PHASE.IDLE) {
    return null
  }
  // 终结态（失败/中断）且没有已生成内容时不留空气泡；streaming 态需承载"思考中"
  if (run.phase !== RUN_PHASE.STREAMING && run.text === '') {
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

/** 仅对当前活跃命中做 DOM 标记与滚动定位（命中量大时不做全量渲染优化）。 */
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

/* ---------- 自动置底（跟随最新） ---------- */

/** 距底部这么多像素以内即视为"跟随最新" */
const STICK_THRESHOLD_PX = 80

/** 是否跟随最新：用户向上翻阅时暂停，回到近底部即恢复 */
let stick = true

const firstId = computed(() => props.messages[0]?.id ?? '')
const lastId = computed(() => props.messages[props.messages.length - 1]?.id ?? '')
/** 流式指纹：阶段、思考、正文、工具数量任一变化都需跟随 */
const streamKey = computed(
  () =>
    `${props.streaming?.phase ?? ''}|${props.streaming?.text.length ?? 0}|${
      props.streaming?.thinking.length ?? 0
    }|${props.streaming?.toolCalls.length ?? 0}`,
)

function isNearBottom(): boolean {
  const element = listRef.value
  if (!element) return true
  return element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_THRESHOLD_PX
}

function scrollToLatest(): void {
  const element = listRef.value
  if (!element) return
  element.scrollTop = element.scrollHeight
}

function onScroll(): void {
  stick = isNearBottom()
}

// 基线取自首帧，否则首次变化会被误判为"首条也变了"（会话切换）
let previousFirst = firstId.value
let previousLast = lastId.value
let previousCount = props.messages.length

watch(
  () => [firstId.value, lastId.value, props.messages.length] as const,
  ([first, last, count]) => {
    const firstChanged = first !== previousFirst
    const lastChanged = last !== previousLast
    const grew = count > previousCount
    previousFirst = first
    previousLast = last
    previousCount = count

    // 加载更早消息（前插）：补偿新增高度，让视口停在原内容上，不跳到底部
    if (firstChanged && !lastChanged && grew) {
      const before = listRef.value?.scrollHeight ?? 0
      void nextTick(() => {
        const element = listRef.value
        if (element) element.scrollTop += element.scrollHeight - before
      })
      return
    }

    // 会话切换：直接置底并恢复跟随
    if (firstChanged) {
      stick = true
      void nextTick(scrollToLatest)
      return
    }

    // 追加新消息（首条未变、末条变化）：原本贴底则继续跟随
    if (lastChanged && stick) {
      void nextTick(scrollToLatest)
    }
  },
)

// 流式增量：贴底时跟随；用户向上翻阅时不打扰
watch(streamKey, () => {
  if (stick) void nextTick(scrollToLatest)
})

onMounted(() => {
  stick = true
  void nextTick(scrollToLatest)
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
</script>

<template>
  <div ref="listRef" class="message-list" @scroll="onScroll">
    <button
      v-if="hasMore"
      type="button"
      class="message-list__more"
      @click="emit('load-more')"
    >
      加载更早的消息
    </button>

    <slot v-if="isEmpty" name="empty">
      <EmptyState title="还没有消息" description="在下方输入框发送第一条消息开始对话" />
    </slot>

    <template v-else>
      <MessageBubble
        v-for="(message, index) in messages"
        :key="message.id"
        v-memo="[message, searchKeyword, activeMatchIndex, matchStats.bases[index]]"
        :message="message"
        :search-keyword="searchKeyword"
        :active-match-index="activeMatchIndex"
        :match-index-base="matchStats.bases[index]"
        @feedback="onFeedback"
        @open-link="onOpenLink"
        @open-file="onOpenFile"
      />

      <!-- 乐观用户气泡（十七次调整）：发送即出现；流终结时随 `pendingUser` 清除，由历史真身接管 -->
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
        :search-keyword="searchKeyword"
        :active-match-index="activeMatchIndex"
        :match-index-base="matchStats.total"
        @feedback="onFeedback"
        @open-link="onOpenLink"
        @open-file="onOpenFile"
      />
    </template>
  </div>
</template>

<style scoped>
.message-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  overflow-y: auto;
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
