<script setup lang="ts">
import BaseIcon from '../common/BaseIcon.vue'

withDefaults(
  defineProps<{
    text?: string
  }>(),
  { text: '' },
)

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div class="upload-hint" role="status">
    <p class="upload-hint__text">{{ text }}</p>
    <button
      type="button"
      class="upload-hint__close"
      aria-label="关闭提示"
      @click="emit('close')"
    >
      <BaseIcon name="close" :size="12" />
    </button>
  </div>
</template>

<style scoped>
.upload-hint {
  position: absolute;
  bottom: calc(100% + var(--space-2));
  left: 0;
  z-index: 10;
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  width: max-content;
  max-width: 240px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  animation: upload-hint-in var(--motion-duration-fast) var(--motion-easing-standard);
}

.upload-hint__text {
  color: var(--color-text);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-base);
  overflow-wrap: anywhere;
}

.upload-hint__close {
  display: inline-flex;
  flex: none;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.upload-hint__close:hover {
  color: var(--color-text);
}

.upload-hint__close:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

@keyframes upload-hint-in {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .upload-hint {
    animation: none;
  }
}
</style>
