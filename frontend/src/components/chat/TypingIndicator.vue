<script setup lang="ts">
/**
 * 流式等待指示（T035）
 *
 * 发送后、首个 `content` 事件到达前展示"思考中"（FR-020）。
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
