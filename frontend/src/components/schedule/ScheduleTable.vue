<script setup lang="ts">
/**
 * 任务表格（015，T038）
 *
 * - 原生 `<table>`：表头 `scope="col"` 让读屏把"列名 ↔ 单元格"关联起来（宪章原则四）；
 * - 行 `key` 用稳定的 `task.task_id`，并用 `v-memo` 只盯"任务对象 + busy"两个标量：
 *   心跳每次广播都会重拉列表，没有记忆化时 20 行 × 每 2 秒重渲染一次（原则五）；
 * - 空态给创建引导（不是一句"暂无数据"就完了），加载失败给**错误态 + 重试**，
 *   两种情况都不冒充"没有任务"。
 */
import type { ErrorInfo, ScheduledTask } from '../../api/types'
import ScheduleRow from './ScheduleRow.vue'

const props = withDefaults(
  defineProps<{
    tasks?: ScheduledTask[]
    /** 有请求在途的任务 id（行内按钮置灰） */
    pendingIds?: readonly string[]
    loading?: boolean
    error?: ErrorInfo | null
  }>(),
  { tasks: () => [], pendingIds: () => [], loading: false, error: null },
)

const emit = defineEmits<{
  toggle: [payload: { taskId: string; enabled: boolean }]
  /** 行内编辑入口（2026-10-30 增补）：由覆盖层打开共用表单弹窗 */
  edit: [taskId: string]
  remove: [taskId: string]
  create: []
  reload: []
}>()

const isBusy = (taskId: string): boolean => props.pendingIds.includes(taskId)
</script>

<template>
  <div class="schedule-table">
    <p v-if="error" class="schedule-table__error" role="alert">
      任务加载失败：{{ error.message || '请稍后重试' }}
      <button type="button" class="schedule-table__link" @click="emit('reload')">重试</button>
    </p>

    <table v-else-if="tasks.length > 0" class="schedule-table__table">
      <caption class="visually-hidden">定时任务列表</caption>
      <thead>
        <tr>
          <th scope="col">任务名称</th>
          <th scope="col">状态</th>
          <th scope="col">执行频率</th>
          <th scope="col">已执行</th>
          <th scope="col">下次触发</th>
          <th scope="col">操作</th>
        </tr>
      </thead>
      <tbody>
        <ScheduleRow
          v-for="task in tasks"
          :key="task.task_id"
          v-memo="[task, isBusy(task.task_id)]"
          :task="task"
          :busy="isBusy(task.task_id)"
          @toggle="emit('toggle', $event)"
          @edit="emit('edit', $event)"
          @remove="emit('remove', $event)"
        />
      </tbody>
    </table>

    <div v-else class="schedule-table__empty">
      <p class="schedule-table__empty-title">还没有定时任务</p>
      <p class="schedule-table__empty-desc">
        创建后，数字人会按你设定的频率自动发起对话，结果会出现在左侧会话列表里。
      </p>
      <button type="button" class="schedule-table__create" @click="emit('create')">
        创建定时任务
      </button>
    </div>

    <p v-if="loading && tasks.length === 0" class="schedule-table__loading" role="status">
      正在加载任务…
    </p>
  </div>
</template>

<style scoped>
.schedule-table {
  min-height: 0;
  overflow: auto;
}

.schedule-table__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.schedule-table__table th,
.schedule-table__table td {
  padding: var(--space-2) var(--space-3);
  text-align: left;
  border-bottom: 1px solid var(--color-border);
}

.schedule-table__table th {
  position: sticky;
  top: 0;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-weight: 600;
  white-space: nowrap;
}

.schedule-table__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-6) var(--space-4);
  text-align: center;
}

.schedule-table__empty-title {
  font-weight: 600;
}

.schedule-table__empty-desc {
  max-width: 420px;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: 1.7;
}

.schedule-table__create {
  padding: var(--space-2) var(--space-4);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--color-on-primary, #fff);
  font: inherit;
  cursor: pointer;
}

.schedule-table__error {
  padding: var(--space-3);
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
}

.schedule-table__link {
  border: none;
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.schedule-table__loading {
  padding: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
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
