<script setup lang="ts">
withDefaults(
  defineProps<{
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
