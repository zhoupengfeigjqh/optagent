<script setup lang="ts">
/**
 * 基础按钮（T025）
 *
 * - `disabled` / `loading` 时同时禁止交互与事件派发（V-06 的载体之一）
 * - `disabledReason` 通过 `title` 说明原因，供禁用态解释
 */
const props = withDefaults(
  defineProps<{
    /** 视觉变体 */
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    /** 尺寸 */
    size?: 'sm' | 'md'
    /** 是否禁用 */
    disabled?: boolean
    /** 是否处于加载中（同时禁用交互） */
    loading?: boolean
    /** 原生按钮类型 */
    type?: 'button' | 'submit' | 'reset'
    /** 禁用原因（作为 title 提示） */
    disabledReason?: string | null
  }>(),
  {
    variant: 'secondary',
    size: 'md',
    disabled: false,
    loading: false,
    type: 'button',
    disabledReason: null,
  },
)

const emit = defineEmits<{ click: [event: MouseEvent] }>()

function onClick(event: MouseEvent): void {
  if (props.disabled || props.loading) {
    return
  }
  emit('click', event)
}
</script>

<template>
  <button
    class="base-button"
    :class="[`base-button--${variant}`, `base-button--${size}`]"
    :type="type"
    :disabled="disabled || loading"
    :aria-disabled="disabled || loading ? 'true' : undefined"
    :aria-busy="loading ? 'true' : undefined"
    :title="disabledReason ?? undefined"
    @click="onClick"
  >
    <span v-if="loading" class="base-button__spinner" aria-hidden="true" />
    <span class="base-button__label">
      <slot />
    </span>
  </button>
</template>

<style scoped>
.base-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font: inherit;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.base-button--sm {
  padding: var(--space-1) var(--space-3);
  font-size: var(--font-size-sm);
}

.base-button--md {
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-md);
}

.base-button--primary {
  background: var(--color-primary);
  color: var(--color-text-inverse);
}

.base-button--primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.base-button--secondary {
  background: var(--color-surface);
  border-color: var(--color-border);
  color: var(--color-text);
}

.base-button--secondary:hover:not(:disabled) {
  background: var(--color-bg-subtle);
}

.base-button--ghost {
  background: transparent;
  color: var(--color-text-muted);
}

.base-button--ghost:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.base-button--danger {
  background: var(--color-status-error);
  color: var(--color-text-inverse);
}

.base-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.base-button__label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.base-button__spinner {
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: base-button-spin 0.7s linear infinite;
}

@keyframes base-button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
