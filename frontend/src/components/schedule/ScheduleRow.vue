<script setup lang="ts">
/**
 * 任务表格行（015，T037 / T051）
 *
 * 六列：任务名 / 状态 / 频率 / 已执行 / 下次触发 / 操作。行尾三个原生按钮：
 * **启停 → 编辑（笔）→ 删除（×）**，DOM 顺序即 Tab 顺序。
 *
 * 四条口径：
 * 1. **启停两态形状不同**：停用态 = 三角（▶ 启动），启用态 = **红色方块**（■ 停止）。
 *    形状 + 颜色 + `aria-pressed` 三重区分，不只靠颜色（宪章原则四）。
 * 2. **启用中只有停止可用**（2026-10-30 增补）：编辑与删除原生禁用，原因放 `title`；
 *    处理函数里再兜一层（`role="status"` 就地提示），防止程序化触发绕过禁用态。
 * 3. **启停按钮的可用性只看 `can_start`**（服务端派生）：次数用尽 / 已过截止 / 数字人不可用时
 *    按钮原生禁用，并把原因放在 `title` 上——前端 MUST NOT 自己再算一遍次数与截止时间。
 * 4. 折叠要点：内联文案全部来自 `utils/schedule-format.ts`（唯一真源）。
 */
import { computed, ref, watch } from 'vue'

import type { ScheduledTask } from '../../api/types'
import { formatCount, formatInterval, formatNextRun } from '../../utils/schedule-format'
import BaseIcon from '../common/BaseIcon.vue'
import ScheduleStatus from './ScheduleStatus.vue'

const props = withDefaults(
  defineProps<{
    task: ScheduledTask
    /** 该行有请求在途（启停 / 编辑 / 删除），三个按钮同时置灰 */
    busy?: boolean
  }>(),
  { busy: false },
)

const emit = defineEmits<{
  toggle: [payload: { taskId: string; enabled: boolean }]
  edit: [taskId: string]
  remove: [taskId: string]
}>()

/** 启用中点击删除的就地提示（不发请求）；切换任务/状态后自动清除 */
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
        <!-- 停用态 = 三角；启用态 = 红色方块。形状本身承载状态，不只靠颜色 -->
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

/* 启用态 = 停止：红色方块（颜色语义明确，形状与三角启动区分开） */
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
