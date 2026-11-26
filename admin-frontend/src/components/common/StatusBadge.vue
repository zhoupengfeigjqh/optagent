<script setup lang="ts">
import { computed } from 'vue'
import { STATUS_PRESETS, type BadgeTone } from '../../constants/status-presets'

const props = defineProps<{
  status: string
  label?: string
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
