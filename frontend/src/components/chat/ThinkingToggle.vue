<script setup lang="ts">
/**
 * 思考模式开关（T049，FR-012）
 *
 * 文案固定为「思考」：选中 = 开启思考（白字蓝底），未选中 = 快速模式（黑字白底）。
 * 颜色不是唯一线索——`role="switch"` + `aria-checked` 已把开/关状态暴露给辅助技术。
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
    <span class="thinking-toggle__label">思考</span>
  </button>
</template>

<style scoped>
/* 未选中 = 快速模式：黑字白底 */
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

/* 选中 = 开启思考：白字蓝底 */
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
