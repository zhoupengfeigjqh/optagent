<script setup lang="ts">
/**
 * 思考块（T037）
 *
 * 默认**收起**，点击摘要可展开/收起；`streaming` 变化 MUST NOT 改变展开状态
 * （否则思考流式增长时用户刚展开的块会被强制收起）。
 * 思考内容不落历史（V-04），因此本组件只在当前轮由 `useChatStream` 驱动渲染。
 */
import { ref } from 'vue'

withDefaults(
  defineProps<{
    /** 思考全文 */
    text: string
    /** 是否仍在流式生成 */
    streaming?: boolean
  }>(),
  { streaming: false },
)

const open = ref(false)
</script>

<template>
  <details v-if="text.trim() !== ''" class="thinking-block" :open="open">
    <summary class="thinking-block__summary" @click.prevent="open = !open">
      <span class="thinking-block__title">思考过程</span>
      <span v-if="streaming" class="thinking-block__hint">生成中</span>
    </summary>
    <div class="thinking-block__body">{{ text }}</div>
  </details>
</template>

<style scoped>
.thinking-block {
  margin-bottom: var(--space-2);
  border-left: 2px solid var(--color-border);
  padding-left: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.thinking-block__summary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
  user-select: none;
}

.thinking-block__title {
  font-weight: 600;
}

.thinking-block__body {
  margin-top: var(--space-2);
  white-space: pre-wrap;
  line-height: 1.7;
}
</style>
