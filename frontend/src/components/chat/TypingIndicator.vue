<script setup lang="ts">
/**
 * 流式等待指示（T035）
 *
 * 两段空档共用：①发送后、首个 `content` 事件到达前 → 缺省「思考中」（FR-020）；
 * ②工具调用执行中 → 由 `MessageBubble` 传入「正在执行 <工具名>…」（2026-11-16）。
 * 文案由调用方决定，本组件只负责转圈与语义。
 * `role="status"` 让读屏获知等待状态；`prefers-reduced-motion` 下由 `base.css` 降级为静态。
 */
withDefaults(
  defineProps<{
    /** 展示文案 */
    label?: string
  }>(),
  { label: '思考中' },
)
</script>

<template>
  <div class="typing-indicator" role="status" aria-live="polite">
    <span class="typing-indicator__spinner" aria-hidden="true" />
    <span class="typing-indicator__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.typing-indicator {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.typing-indicator__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: typing-indicator-spin 0.8s linear infinite;
}

@keyframes typing-indicator-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
