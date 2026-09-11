<script setup lang="ts">
/**
 * 思考 / 快速模式切换（T049，FR-012）
 *
 * 用 `role="switch"` + `aria-checked` 暴露开关语义；按钮文案直接写出当前模式，
 * 使"处于哪种模式"无需依赖颜色即可读（SC 的可访问性要求）。
 * 切换本身只改本地开关，随下一条消息提交（请求级参数）。
 */
const props = withDefaults(
  defineProps<{
    /** 是否处于思考模式 */
    thinking?: boolean
    /** 是否禁用 */
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
    <span class="thinking-toggle__label">{{ thinking ? '思考' : '快速' }}</span>
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
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.thinking-toggle--on {
  border-color: var(--color-primary);
  background: var(--color-primary-subtle);
  color: var(--color-primary);
}

.thinking-toggle:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
