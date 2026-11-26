<script setup lang="ts">
import BaseIcon from '../common/BaseIcon.vue'

const props = withDefaults(
  defineProps<{
    open?: boolean
    /** 是否不可用（未选数字人 / 数字人不可用） */
    disabled?: boolean
    /** 不可用原因（`title` 与隐藏文本共用） */
    disabledReason?: string | null
  }>(),
  { open: false, disabled: false, disabledReason: null },
)

const emit = defineEmits<{ open: [] }>()

function onClick(): void {
  if (props.disabled) return
  emit('open')
}
</script>

<template>
  <button
    type="button"
    class="schedule-entry"
    :class="{ 'schedule-entry--active': open }"
    aria-label="定时任务"
    :aria-pressed="open ? 'true' : 'false'"
    :disabled="disabled"
    :title="disabled ? (disabledReason ?? '暂不可用') : '定时任务'"
    @click="onClick"
  >
    <BaseIcon name="schedule" :size="16" />
    <span v-if="disabled" class="visually-hidden">
      （不可用：{{ disabledReason ?? '暂不可用' }}）
    </span>
  </button>
</template>

<style scoped>
.schedule-entry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.schedule-entry:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.schedule-entry--active {
  background: var(--color-primary-subtle);
  color: var(--color-primary);
}

.schedule-entry:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
