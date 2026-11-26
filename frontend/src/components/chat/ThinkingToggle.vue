<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    thinking?: boolean
    disabled?: boolean
  }>(),
  { thinking: false, disabled: false },
)

const emit = defineEmits<{ toggle: [] }>()

function onClick(): void {
  if (props.disabled) {
    return
  }
  emit('toggle')
}
</script>

<template>
  <button
    type="button"
    class="thinking-toggle"
    :class="{ 'thinking-toggle--on': thinking }"
    role="switch"
    :aria-checked="thinking ? 'true' : 'false'"
    :disabled="disabled"
    @click="onClick"
  >
    <span class="thinking-toggle__label">思考</span>
  </button>
</template>

<style scoped>
.thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.thinking-toggle--on {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-text-inverse);
}

.thinking-toggle:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
