<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { ScheduledTask } from '../../api/types'
import { formatCount, formatInterval, formatNextRun } from '../../utils/schedule-format'
import BaseIcon from '../common/BaseIcon.vue'
import ScheduleStatus from './ScheduleStatus.vue'

const props = withDefaults(
  defineProps<{
    task: ScheduledTask
    busy?: boolean
  }>(),
  { busy: false },
)

const emit = defineEmits<{
  toggle: [payload: { taskId: string; enabled: boolean }]
  edit: [taskId: string]
  remove: [taskId: string]
}>()

const blockedHint = ref('')

watch(
  () => [props.task.task_id, props.task.enabled],
  () => {
    blockedHint.value = ''
  },
)

/** 启停按钮不可用的原因（只用服务端派生字段判定） */
function toggleDisabledReason(): string {
  if (props.task.disabled_reason === 'agent_unavailable') return '数字人不可用，请先修复数字人配置'
  if (props.task.terminated) return '已用尽执行次数或超过有效截止时间'
  return ''
}

const toggleDisabled = (): boolean => props.busy || (!props.task.enabled && !props.task.can_start)

/**
 * 编辑 / 删除的可用性：请求在途 OR 任务启用中。
 *
 * 启用中一律不可编辑/删除（2026-10-30 需求第 3 条）：编辑要替换整份配置，
 * 删除要摘掉调度——两者都可能与"正在进行的那一轮"交错。先停再改，语义最简单。
 */
const secondaryDisabled = computed(() => props.busy || props.task.enabled)

/** 编辑 / 删除不可用的原因（唯一的用户可见解释处） */
const secondaryReason = computed(() => (props.task.enabled ? '请先停止任务' : ''))

function onToggle(): void {
  if (toggleDisabled()) return
  emit('toggle', { taskId: props.task.task_id, enabled: !props.task.enabled })
}

function onEdit(): void {
  if (secondaryDisabled.value) {
    if (props.task.enabled) blockedHint.value = '请先停止任务再编辑'
    return
  }
  emit('edit', props.task.task_id)
}

function onRemove(): void {
  if (secondaryDisabled.value) {
    if (props.task.enabled) {
      // 先停用再删除（FR-018）：这里只提示，不替用户顺手停用——停用是有副作用的动作
      blockedHint.value = '请先停止任务再删除'
    }
    return
  }
  emit('remove', props.task.task_id)
}
</script>

<template>
  <tr class="schedule-row">
    <td class="schedule-row__name">
      <span class="schedule-row__name-text" :title="task.name">{{ task.name }}</span>
      <span v-if="task.disabled_reason === 'agent_unavailable'" class="schedule-row__badge">
        数字人不可用
      </span>
    </td>
    <td><ScheduleStatus :task="task" /></td>
    <td class="schedule-row__muted">{{ formatInterval(task.interval_seconds) }}</td>
    <td class="schedule-row__muted">{{ formatCount(task.executed_count, task.max_runs) }}</td>
    <td class="schedule-row__muted">{{ formatNextRun(task) }}</td>
    <td class="schedule-row__actions">
      <button
        type="button"
        class="schedule-row__action"
        :class="{ 'schedule-row__action--stop': task.enabled }"
        :disabled="toggleDisabled()"
        :aria-pressed="task.enabled ? 'true' : 'false'"
        :aria-label="task.enabled ? `停止任务：${task.name}` : `启动任务：${task.name}`"
        :title="toggleDisabledReason() || (task.enabled ? '停止任务' : '启动任务')"
        @click="onToggle"
      >
        <span v-if="task.enabled" class="schedule-row__stop-square" aria-hidden="true" />
        <BaseIcon v-else name="play" :size="14" />
      </button>

      <button
        type="button"
        class="schedule-row__action"
        :disabled="secondaryDisabled"
        :aria-label="`编辑任务：${task.name}`"
        :title="secondaryReason || '编辑任务'"
        @click="onEdit"
      >
        <BaseIcon name="edit" :size="14" />
      </button>

      <button
        type="button"
        class="schedule-row__action schedule-row__remove"
        :disabled="secondaryDisabled"
        :aria-label="`删除任务：${task.name}`"
        :title="secondaryReason || '删除任务'"
        @click="onRemove"
      >
        <BaseIcon name="close" :size="14" />
      </button>

      <span v-if="blockedHint" class="schedule-row__hint" role="status">{{ blockedHint }}</span>
    </td>
  </tr>
</template>

<style scoped>
.schedule-row__name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.schedule-row__name-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.schedule-row__badge {
  flex: none;
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--color-status-error-bg);
  color: var(--color-status-error);
  font-size: var(--font-size-xs);
}

.schedule-row__muted {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

.schedule-row__actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  white-space: nowrap;
}

.schedule-row__action {
  display: inline-flex;
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.schedule-row__action:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.schedule-row__action--stop {
  color: var(--color-status-error);
}

.schedule-row__stop-square {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background: currentcolor;
}

.schedule-row__action:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.schedule-row__remove:hover:not(:disabled) {
  background: var(--color-status-error-bg);
  color: var(--color-status-error);
}

.schedule-row__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
</style>
