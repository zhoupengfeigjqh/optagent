<script setup lang="ts">
/**
 * 代码块（2026-10-16）
 *
 * 只做两件正文块做不到的事：等宽 + 横向滚动（不外溢撑破气泡）、一键复制。
 * 正文渲染复用 `MessageSegments`（搜索高亮与外链样式只在那一个文件里定义），
 * 所以代码块内的命中同样可高亮、同样可被"下一个命中"跳转命中。
 *
 * 剪贴板不可用（非安全上下文、权限被拒）时静默不改文案——与 `MessageActions` 的
 * 复制按钮同口径：宁可没有反馈，也不要谎报"已复制"。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import type { ContentSegment } from '../../utils/segments'
import BaseIcon from '../common/BaseIcon.vue'
import MessageSegments from './MessageSegments.vue'

/** 复制成功提示的停留时长（与 `MessageActions` 对齐） */
const COPY_FEEDBACK_MS = 2000

const props = defineProps<{
  /** 围栏上标注的语言（可空，仅作角标展示） */
  language: string
  /** 已切好分段的代码文本（分段里带搜索命中序号） */
  segments: ContentSegment[]
}>()

const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

/**
 * 复制的是**代码原文**：分段是原文的无损切分（`utils/segments.ts` 的可测不变式），
 * 拼回来即可——不必再去读一次 DOM、也不会把高亮标记一起复制进去。
 */
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
  /* 横向滚动而不是撑破气泡：长命令行是 agent 输出的常态 */
  overflow-x: auto;
}

.message-code__code {
  font-family: var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  white-space: pre;
}
</style>
