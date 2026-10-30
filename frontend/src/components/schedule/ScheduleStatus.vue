<script setup lang="ts">
/**
 * 任务状态（015，T036）
 *
 * **文字 + 圆点双通道**：颜色不是唯一载体（色觉障碍用户看得到文字，读屏读得到文字）。
 * 文案统一来自 `utils/schedule-format.ts` 的 `formatTaskStatus`——表格、运行记录、
 * 状态圆点三处共用一份，避免同义漂移。
 */
import { computed } from 'vue'

import type { ScheduledTask } from '../../api/types'
import { formatTaskStatus } from '../../utils/schedule-format'

const props = defineProps<{
  task: Pick<ScheduledTask, 'status' | 'terminated' | 'disabled_reason'>
}>()

const label = computed(() => formatTaskStatus(props.task))

/** 圆点色调：执行中绿、已结束灰、系统停用红、未开始灰 */
const tone = computed(() => {
  if (props.task.disabled_reason === 'agent_unavailable') return 'error'
  if (props.task.terminated) return 'muted'
  return props.task.status === 'running' ? 'running' : 'idle'
})
</script>

<template>
  <span class="schedule-status" :class="`schedule-status--${tone}`">
    <span class="schedule-status__dot" aria-hidden="true" />
    <span class="schedule-status__text">{{ label }}</span>
  </span>
</template>

<style scoped>
.schedule-status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.schedule-status__dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: var(--color-text-muted);
}

.schedule-status--running .schedule-status__dot {
  background: var(--color-status-success, #16a34a);
}

.schedule-status--error .schedule-status__dot {
  background: var(--color-status-error);
}

.schedule-status--muted .schedule-status__dot {
  background: var(--color-border);
}
</style>
