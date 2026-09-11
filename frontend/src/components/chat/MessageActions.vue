<script setup lang="ts">
/**
 * 消息操作区（T044）
 *
 * 承载复制、点赞/点踩与用量（token）、耗时。
 *
 * 选中态**受控**：由 `feedback` prop 驱动，组件只上报"用户点了哪一侧"；
 * "同值重复提交 = 取消"（V-08）的换算由 `MessageBubble` 依当前值判定后提交 `null`。
 * 复制在本组件内完成并给出短暂成功反馈，同时派发 `copy` 供上层观察。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import type { Usage } from '../../api/types'
import { formatDuration, formatTokens } from '../../utils/format'
import BaseIcon from '../common/BaseIcon.vue'

/** 复制成功反馈的展示时长。 */
const COPY_FEEDBACK_MS = 2000

const props = withDefaults(
  defineProps<{
    /** 用量；`null` 时不展示 token */
    usage?: Usage | null
    /** 整轮耗时（秒）；按 1 位小数展示 */
    durationSeconds?: number | null
    /** 当前反馈选中态 */
    feedback?: 'up' | 'down' | null
    /** 提交中禁用重复点击 */
    disabled?: boolean
    /** 待复制正文；为空表示由上层自行处理复制（扩展属性，便于组件内确认成功） */
    copyText?: string
  }>(),
  { usage: null, durationSeconds: null, feedback: null, disabled: false, copyText: '' },
)

const emit = defineEmits<{
  copy: []
  feedback: [value: 'up' | 'down']
}>()

const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

const tokenText = computed(() => formatTokens(props.usage))
const durationText = computed(() => formatDuration(props.durationSeconds))

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

async function writeClipboard(): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard
  if (props.copyText === '' || !clipboard) {
    return
  }
  try {
    await clipboard.writeText(props.copyText)
    copied.value = true
    clearTimer()
    timer = setTimeout(() => {
      copied.value = false
    }, COPY_FEEDBACK_MS)
  } catch {
    copied.value = false
  }
}

function onClickCopy(): void {
  if (props.disabled) {
    return
  }
  emit('copy')
  void writeClipboard()
}

function onClickFeedback(value: 'up' | 'down'): void {
  if (props.disabled) {
    return
  }
  emit('feedback', value)
}

onBeforeUnmount(clearTimer)
</script>

<template>
  <div class="message-actions">
    <span v-if="tokenText" class="message-actions__usage">{{ tokenText }}</span>
    <span v-if="durationText" class="message-actions__duration">{{ durationText }}</span>

    <button
      type="button"
      class="message-actions__copy"
      :disabled="disabled"
      @click="onClickCopy"
    >
      <BaseIcon name="copy" :size="14" />
      <span class="message-actions__hint">{{ copied ? '已复制' : '复制' }}</span>
    </button>

    <button
      type="button"
      class="message-actions__up"
      :disabled="disabled"
      :aria-pressed="feedback === 'up' ? 'true' : 'false'"
      aria-label="点赞"
      @click="onClickFeedback('up')"
    >
      <BaseIcon name="thumb-up" :size="14" />
    </button>

    <button
      type="button"
      class="message-actions__down"
      :disabled="disabled"
      :aria-pressed="feedback === 'down' ? 'true' : 'false'"
      aria-label="点踩"
      @click="onClickFeedback('down')"
    >
      <BaseIcon name="thumb-down" :size="14" />
    </button>
  </div>
</template>

<style scoped>
.message-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.message-actions__usage,
.message-actions__duration {
  white-space: nowrap;
}

.message-actions__copy,
.message-actions__up,
.message-actions__down {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.message-actions__copy:hover:not(:disabled),
.message-actions__up:hover:not(:disabled),
.message-actions__down:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.message-actions__up[aria-pressed='true'],
.message-actions__down[aria-pressed='true'] {
  background: var(--color-primary-subtle);
  color: var(--color-primary);
}

.message-actions__copy:disabled,
.message-actions__up:disabled,
.message-actions__down:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
