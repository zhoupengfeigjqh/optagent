<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import type { ContentSegment } from '../../utils/segments'
import BaseIcon from '../common/BaseIcon.vue'
import MessageSegments from './MessageSegments.vue'

const COPY_FEEDBACK_MS = 2000

const props = defineProps<{
  language: string
  segments: ContentSegment[]
}>()

const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

const codeText = computed(() => props.segments.map((segment) => segment.text).join(''))

async function onCopy(): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard
  if (!clipboard || codeText.value === '') {
    return
  }
  try {
    await clipboard.writeText(codeText.value)
    copied.value = true
    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      copied.value = false
      timer = null
    }, COPY_FEEDBACK_MS)
  } catch {
    copied.value = false
  }
}

onBeforeUnmount(() => {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
})
</script>

<template>
  <figure class="message-code">
    <figcaption class="message-code__bar">
      <span class="message-code__language">{{ language || 'code' }}</span>
      <button
        type="button"
        class="message-code__copy"
        :aria-label="copied ? '已复制代码' : '复制代码'"
        :title="copied ? '已复制' : '复制代码'"
        @click="onCopy"
      >
        <BaseIcon name="copy" :size="14" />
        <span class="message-code__copy-text">{{ copied ? '已复制' : '复制' }}</span>
      </button>
    </figcaption>
    <pre class="message-code__pre"><code class="message-code__code"><MessageSegments
      :segments="segments"
    /></code></pre>
  </figure>
</template>

<style scoped>
.message-code {
  margin: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
  overflow: hidden;
}

.message-code__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.message-code__copy {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.message-code__copy:hover {
  color: var(--color-text);
}

.message-code__pre {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  overflow-x: auto;
}

.message-code__code {
  font-family: var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  white-space: pre;
}
</style>
