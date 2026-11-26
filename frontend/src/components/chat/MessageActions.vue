<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import type { Usage } from '../../api/types'
import { formatDurationSec, formatTokens } from '../../utils/format'
import BaseIcon from '../common/BaseIcon.vue'

const COPY_FEEDBACK_MS = 2000

const props = withDefaults(
  defineProps<{
    usage?: Usage | null
    durationSeconds?: number | null
    feedback?: 'up' | 'down' | null
    disabled?: boolean
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
const durationText = computed(() => formatDurationSec(props.durationSeconds))

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

    <button type="button" class="message-actions__copy" :disabled="disabled" @click="onClickCopy">
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
