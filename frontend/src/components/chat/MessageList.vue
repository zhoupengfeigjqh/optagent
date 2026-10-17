<script setup lang="ts">
/**
 * 消息列表（T040）
 *
 * - 空消息且无流式 → 初始入口占位（`empty` 插槽可替换）
 * - 有消息 → 逐条渲染 `MessageBubble`，并用 `v-memo` 抑制无关重渲染
 * - 流式 → 追加"合成气泡"承载本轮思考/工具/正文；其**上方**先渲染乐观用户气泡
 *   （`pendingUser`，十七次调整：发送即出现，完成后由历史真身接管，不重复）
 * - 搜索 → 计算每条消息的全局匹配基准序号，并只对当前活跃序号滚动定位
 * - **滚动跟随 / 会话位置记忆 / 读屏播报**（2026-10-16 起由 `useMessageScroll` 承担）：
 *   自动置底、上翻暂停、本端发送强制置底、「回到底部」按钮的唯一真源 `atBottom`、
 *   切回旧会话恢复位置、以及"只播结论"的读屏播报，全部实现在
 *   `composables/useMessageScroll.ts`（本组件只消费它返回的 4 个出口）。
 *   本文件由此降到 500 行以内（宪章原则二）。
 * - **失败轮「重试本轮」**（2026-10-15）：从历史里解析该轮的用户消息并上抛（此处是全仓
 *   唯一知道"失败消息的上一轮用户消息是谁"的地方——它按索引向前找，不需要 id 反查）；
 *   解析不出（该消息不在已加载分页窗口内）则不给入口，见 `retryLabels`
 */
import { computed, nextTick, ref, watch } from 'vue'

import type {
  AgentStarter,
  ErrorInfo,
  FileReference,
  Message,
  ToolCallResult,
} from '../../api/types'
import type { ThreadNextSteps } from '../../api/threads'
import { MESSAGE_ROLE, MESSAGE_STATUS, RUN_PHASE, type RunPhase } from '../../constants/events'
import type { PendingUserMessage } from '../../composables/useChatStream'
import { useMessageScroll } from '../../composables/useMessageScroll'
import { countMatches } from '../../utils/segments'
import type { ViewLinkTarget } from '../../utils/view-link'
import BaseIcon from '../common/BaseIcon.vue'
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
  /** 本轮回答的数字人（009 起会话归属固定：数字人不可在会话中途变更；逐条标注保留以兼容存量数据） */
  agentName: string | null
  /** 本轮是否有可重发的用户消息缓存（中断轮 / 服务端已终局的失败轮）→「重新生成」按钮渲染条件 */
  canRegenerate?: boolean
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
    /**
     * 工具卡片懒加载外置结果正文（002 特性）；缺省 = 卡片只展示已下发的内联内容与摘要。
     * 仅历史气泡使用（流式轮次尚无结果）。
     */
    loadToolResult?: ((callId: string) => Promise<ToolCallResult>) | undefined
    /**
     * 会话最新一轮的下一步动作提示（007）。
     *
     * 只在 `message.id === message_id` 的那条气泡上透传（`visibleActions` 也守同一判据）：
     * 历史轮次一律不展示卡片（FR-015）。
     */
    nextSteps?: ThreadNextSteps | null
    /**
     * 当前会话 id（2026-10-16）：**只**用作"切回旧会话恢复上次滚动位置"的存档键。
     * `null` = 视图态新对话，没有稳定身份，不存档。
     */
    threadId?: string | null
  }>(),
  {
    messages: () => [],
    streaming: null,
    pendingUser: null,
    searchKeyword: '',
    activeMatchIndex: -1,
    hasMore: false,
    loadToolResult: undefined,
    nextSteps: null,
    threadId: null,
  },
)

const emit = defineEmits<{
  'load-more': []
  /** 消息反馈（契约未列该项，为向上透传的最小超集；`copy` 由 MessageActions 就地完成） */
  feedback: [payload: { message_id: string; value: 'up' | 'down' | null }]
  /**
   * 失败轮「重试本轮」：载荷是**该轮的用户消息**（正文 + 引用）——重发所需的最小集，
   * 形状正对 `onSend` 的入参，装配层据此直接复用唯一发送链路（引用校验 / 会话创建 /
   * 失败还原草稿都在那条链路上）。
   */
  retry: [payload: { content: string; attachments: FileReference[] }]
  /** 中断轮「重新生成」（由流式气泡触发，向上透传至装配层重发） */
  regenerate: []
  /** 外部地址点击（契约未列，向上透传；V-10 直跳由装配层执行） */
  'open-link': [href: string]
  /** 空间目录文件点击（契约未列，向上透传；FR-046 预览由装配层执行） */
  'open-file': [reference: FileReference]
  /** 跳转入口点击（`viewUrl` / `filePath` 归一化后；打开方式由装配层按 `kind` 判定） */
  'open-view': [item: ViewLinkTarget]
  /** 下一步动作卡片点选（007，向上透传；确认与发送由 ChatPanel 执行） */
  'send-suggestion': [action: AgentStarter]
}>()

const listRef = ref<HTMLElement | null>(null)

const isEmpty = computed(
  () => props.messages.length === 0 && props.streaming === null && props.pendingUser === null,
)

/** 卡片归属消息 id（`''` = 无卡片）：`v-memo` 用它触发"卡片刚到达"的重渲染 */
const nextStepsId = computed(() => props.nextSteps?.message_id ?? '')

/* ---------- 失败轮「重试本轮」（2026-10-15） ---------- */

/** 失败轮重试入口的文案（与 `TR-58` 同一口径：真正的"重发"，不是"重新获取"） */
const RETRY_LABEL = '重试本轮'

/**
 * 失败轮要重发的那一轮：**该消息之前最近的一条用户消息**（正序列表里就是同轮那条）。
 *
 * 为什么必须从历史里解析：失败轮在服务端**已终局**（`status='failed'` 落盘、实例已释放），
 * 重发是唯一有意义的动作；而"上一条用户消息"这个上下文只存在于消息列表里
 * （`useChatStream` 的缓存只覆盖本次会话内刚失败/中断的那一轮，刷新即空）。
 *
 * @returns 重发载荷；该用户消息**不在已加载窗口内**（分页正好切在两者之间）时为 `null`
 */
function retryTurnOf(index: number): { content: string; attachments: FileReference[] } | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const message = props.messages[i]
    if (message && message.role === MESSAGE_ROLE.USER) {
      return { content: message.content, attachments: message.attachments ?? [] }
    }
  }
  return null
}

/**
 * 每条消息的重试入口文案（非失败轮恒为 `null`；失败轮但用户消息不在窗口内也是 `null`）。
 *
 * 判据与气泡自身的渲染条件同源（`status === 'failed'` + 有 `error`）——这里只补上
 * "重发所需的那一轮在不在窗口里"这一条只有列表层才知道的信息。
 *
 * 刻意做成**标量数组**而不是"渲染时现算"：文案是列表层算出来的派生量，可能与消息身份无关地
 * 翻转（"加载更早消息"补进同轮用户消息即是），故它同时作为 `v-memo` 的比较项——`v-memo`
 * 只在比较项变化时才重渲染，若把它留在比较项之外，入口可能长不出来。
 */
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

/* ---------- 自动置底 / 会话位置记忆 / 读屏播报 ---------- */

/**
 * 2026-10-16 起整块抽为 `useMessageScroll`（宪章原则二：单文件 ≤500 行）：
 * 它只依赖这五个入参，与模板的渲染与事件透传没有耦合，抽走后**行为零变化**。
 * 三条口径（上翻暂停 / 本端发送强制置底 / `atBottom` 为唯一真源）写在那个文件的头部。
 */
const { atBottom, announcement, onScroll, scrollToLatest } = useMessageScroll({
  listRef,
  messages: computed(() => props.messages),
  /** 流式指纹：阶段、思考、正文、工具数量任一变化都需跟随 */
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
/**
 * 只把卡片透传给**归属的那一条**消息（其余传 `null`）。
 *
 * 这样历史气泡连"判断要不要渲染"这一步都不必走，`v-memo` 也只需盯住
 * `nextStepsMessageId` 一个标量（数组里多一个对象会频繁打断记忆化）。
 */
function nextStepsOf(message: Message): ThreadNextSteps | null {
  return props.nextSteps && props.nextSteps.message_id === message.id ? props.nextSteps : null
}
</script>

<template>
  <!--
    包裹层只做一件事：给「回到底部」按钮一个**不随内容滚动**的定位参照。
    滚动条仍在内层 `.message-list` 上（那里的类名是既有样式与测试的锚点）。
  -->
  <div class="message-list-wrap">
    <div
      ref="listRef"
      class="message-list"
      role="log"
      aria-label="对话消息"
      aria-live="off"
      @scroll="onScroll"
    >
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
          :load-tool-result="loadToolResult"
          :next-steps="nextStepsOf(message)"
          :retry-label="retryLabels[index]"
          @feedback="onFeedback"
          @retry="onRetry(index)"
          @open-link="onOpenLink"
          @open-file="onOpenFile"
          @open-view="onOpenView"
          @send-suggestion="emit('send-suggestion', $event)"
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

    <!--
      读屏专用播报（视觉隐藏）：只播**结论**（本轮回答已完成）。
      逐 token 的正文变化刻意不播——`role="status"` 会被打字流反复打断，等于噪音；
      "正在生成"由 `TypingIndicator` 负责，这里负责收尾。
    -->
    <p
      class="message-list__announce"
      data-test="message-list-announce"
      role="status"
      aria-live="polite"
    >
      {{ announcement }}
    </p>

    <!--
      回到底部：非底部（用户上翻过、或搜索定位到了旧消息）才出现。
      `atBottom` 为真时不渲染——按钮存在即意味着"下面还有你看不到的内容"。
    -->
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
/*
 * 定位参照层：高度由父级 `.chat-panel__body > * { flex: 1; min-height: 0 }` 撑满，
 * 自身不滚动——「回到底部」按钮因此钉在视口上，不会跟着内容滚走。
 */
.message-list-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
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

/*
 * 回到底部（2026-10-16）：紧贴输入区上沿，右边缘与输入区「发送」按钮落在同一条
 * 垂线上——两者同取 Composer 的左右内边距 `--space-5`。下边距取 `--space-2`
 * （与 Composer 内部 `gap` 同值）：是"紧贴"，不是粘住。
 */
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
