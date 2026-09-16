<script setup lang="ts">
/**
 * 状态徽标：**图标 + 文本双通道**，不只靠颜色（原则四）。
 *
 * 未提供 `label` 时按状态词典取中文名；词典未覆盖的状态回退为原始文本，
 * 保证"未知状态不会被静默显示成空"。
 */
import { computed } from 'vue'
import { STATUS_PRESETS, type BadgeTone } from '../../constants/status-presets'

const props = defineProps<{
  /** 状态标识（如 MCP 的 running / stopped / abnormal / unknown） */
  status: string
  /** 覆盖显示文案 */
  label?: string
  /** 覆盖语义色；缺省按状态词典推断 */
  tone?: BadgeTone
}>()

const preset = computed(() => STATUS_PRESETS[props.status])
const text = computed(() => props.label ?? preset.value?.label ?? props.status)
const tone = computed<BadgeTone>(() => props.tone ?? preset.value?.tone ?? 'neutral')
const icon = computed(() => preset.value?.icon ?? '•')
</script>

<template>
  <span class="status-badge" :class="`status-badge--${tone}`" :data-status="status">
    <span class="status-badge__icon" aria-hidden="true">{{ icon }}</span>
    <span class="status-badge__text">{{ text }}</span>
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  font-size: var(--font-size-xs);
  line-height: var(--line-height-tight);
  white-space: nowrap;
}

.status-badge__icon {
  font-weight: 700;
}

.status-badge--success {
  color: var(--color-status-success);
  background: var(--color-status-success-bg);
  border-color: var(--color-status-success);
}

.status-badge--error {
  color: var(--color-status-error);
  background: var(--color-status-error-bg);
  border-color: var(--color-status-error);
}

.status-badge--warning {
  color: var(--color-status-warning);
  background: var(--color-status-warning-bg);
  border-color: var(--color-status-warning);
}

.status-badge--neutral {
  color: var(--color-text-secondary);
  background: var(--color-status-pending-bg);
  border-color: var(--color-border-strong);
}
</style>
