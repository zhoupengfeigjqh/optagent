<script setup lang="ts">
/**
 * 加载指示（T029）
 *
 * `role="status"` + `aria-live="polite"` 让读屏在等待时获得文字反馈；
 * 动画在 `prefers-reduced-motion` 下由 `base.css` 统一降级。
 */
withDefaults(
  defineProps<{
    /** 读屏与可见文案 */
    label?: string
  }>(),
  { label: '加载中' },
)
</script>

<template>
  <div class="loading-dots" role="status" aria-live="polite">
    <span class="loading-dots__dots" aria-hidden="true">
      <span class="loading-dots__dot" />
      <span class="loading-dots__dot" />
      <span class="loading-dots__dot" />
    </span>
    <span class="loading-dots__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.loading-dots {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.loading-dots__dots {
  display: inline-flex;
  gap: 3px;
}

.loading-dots__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: loading-dots-bounce 1s infinite ease-in-out;
}

.loading-dots__dot:nth-child(2) {
  animation-delay: 0.15s;
}

.loading-dots__dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes loading-dots-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  40% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
</style>
