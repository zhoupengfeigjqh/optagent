<script setup lang="ts">
/**
 * 工具调用徽标（T036）
 *
 * **只展示工具名与状态，绝不展示入参/结果**（V-04、SC-011）。
 * `tool_call_end` 到达后由上游把该项移出列表，徽标随之卸载（V-05）。
 */
import { computed } from 'vue'

type BadgeStatus = 'running' | 'success' | 'error'

const props = withDefaults(
  defineProps<{
    /** 工具名 */
    name: string
    /** 进行状态 */
    status?: BadgeStatus
  }>(),
  { status: 'running' },
)

const STATUS_LABEL: Readonly<Record<BadgeStatus, string>> = {
  running: '进行中',
  success: '已完成',
  error: '失败',
}

const statusLabel = computed(() => STATUS_LABEL[props.status] ?? STATUS_LABEL.running)
</script>

<template>
  <span class="tool-call-badge" :class="`tool-call-badge--${status}`">
    <span class="tool-call-badge__name">{{ name }}</span>
    <span class="tool-call-badge__status">{{ statusLabel }}</span>
  </span>
</template>

<style scoped>
.tool-call-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  font-size: var(--font-size-sm);
}

.tool-call-badge__name {
  font-weight: 600;
}

.tool-call-badge__status {
  color: var(--color-text-muted);
}

.tool-call-badge--success .tool-call-badge__status {
  color: var(--color-status-success);
}

.tool-call-badge--error .tool-call-badge__status {
  color: var(--color-status-error);
}
</style>
