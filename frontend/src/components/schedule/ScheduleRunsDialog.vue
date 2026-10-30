<script setup lang="ts">
/**
 * 运行记录弹窗（015，T056 / T065）
 *
 * 按触发时刻倒序看每次执行的结果，点一行跳回那次会话。
 *
 * 三条口径：
 * 1. **会话已删除 → 该行不可点**，并明确说"会话已删除，不可打开"（不是静默没反应）；
 *    判定由服务端 `thread_deleted` 回填，前端 MUST NOT 再调详情接口试探（避免 N+1）。
 * 2. `skipped` 行没有会话（`thread_id === null`），同样不可点，原因列说明为什么跳过。
 * 3. `rebuilt === true` 加文字标注"重建会话"（`T065`）：复用模式下这一轮是新开的会话，
 *    用户点进去会看到"只有这一轮"——不标注就像丢了一段历史。
 */
import type { ErrorInfo, ScheduleRun, ScheduledTask } from '../../api/types'
import { formatDateTime, formatRebuilt, formatRunReason, formatRunResult } from '../../utils/schedule-format'
import BaseDialog from '../common/BaseDialog.vue'

withDefaults(
  defineProps<{
    open?: boolean
    runs?: ScheduleRun[]
    total?: number
    loading?: boolean
    error?: ErrorInfo | null
    /** 任务清单（筛选下拉） */
    tasks?: ScheduledTask[]
    /** 当前筛选的任务 id；`null` = 全部 */
    filterTaskId?: string | null
  }>(),
  {
    open: false,
    runs: () => [],
    total: 0,
    loading: false,
    error: null,
    tasks: () => [],
    filterTaskId: null,
  },
)

const emit = defineEmits<{
  close: []
  filter: [taskId: string | null]
  'open-thread': [threadId: string]
  reload: []
}>()

const canOpen = (run: ScheduleRun): boolean =>
  run.thread_id !== null && run.thread_id !== '' && !run.thread_deleted

function onRowClick(run: ScheduleRun): void {
  if (!canOpen(run)) return
  emit('open-thread', run.thread_id as string)
}

function onFilterChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  emit('filter', value === '' ? null : value)
}
</script>

<template>
  <BaseDialog :open="open" title="运行记录" wide @close="emit('close')">
    <div class="runs">
      <div class="runs__toolbar">
        <label class="runs__filter">
          <span>按任务筛选</span>
          <select :value="filterTaskId ?? ''" @change="onFilterChange">
            <option value="">全部任务</option>
            <option v-for="task in tasks" :key="task.task_id" :value="task.task_id">
              {{ task.name }}
            </option>
          </select>
        </label>
        <button type="button" class="runs__link" @click="emit('reload')">刷新</button>
      </div>

      <p v-if="error" class="runs__error" role="alert">
        运行记录加载失败：{{ error.message || '请稍后重试' }}
      </p>

      <p v-else-if="loading && runs.length === 0" class="runs__hint" role="status">
        正在加载运行记录…
      </p>

      <p v-else-if="runs.length === 0" class="runs__hint">还没有执行记录</p>

      <table v-else class="runs__table">
        <caption class="visually-hidden"
          >定时任务运行记录，共 {{ total }} 条，按触发时刻倒序</caption
        >
        <thead>
          <tr>
            <th scope="col">会话</th>
            <th scope="col">任务</th>
            <th scope="col">触发时刻</th>
            <th scope="col">结果</th>
            <th scope="col">说明</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="run in runs"
            :key="run.run_id"
            v-memo="[run]"
            class="runs__row"
            :class="{ 'runs__row--openable': canOpen(run) }"
          >
            <td>
              <button
                v-if="canOpen(run)"
                type="button"
                class="runs__thread"
                @click="onRowClick(run)"
              >
                {{ run.thread_title ?? '（未命名会话）' }}
              </button>
              <span v-else-if="run.thread_deleted" class="runs__muted">会话已删除，不可打开</span>
              <span v-else class="runs__muted">未创建会话</span>
            </td>
            <td>{{ run.task_name }}</td>
            <td class="runs__muted">{{ formatDateTime(run.triggered_at) }}</td>
            <td>
              <span :class="`runs__result runs__result--${run.result}`">
                {{ formatRunResult(run.result) }}
              </span>
            </td>
            <td class="runs__muted">
              <span v-if="formatRunReason(run.reason)">{{ formatRunReason(run.reason) }}</span>
              <span v-if="run.reason_text" class="runs__reason-text">· {{ run.reason_text }}</span>
              <span v-if="formatRebuilt(run.rebuilt)" class="runs__rebuilt">
                {{ formatRebuilt(run.rebuilt) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </BaseDialog>
</template>

<style scoped>
.runs {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.runs__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.runs__filter {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.runs__filter select {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}

.runs__link {
  border: none;
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.runs__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.runs__table th,
.runs__table td {
  padding: var(--space-2) var(--space-3);
  text-align: left;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.runs__table th {
  color: var(--color-text-secondary);
  font-weight: 600;
  white-space: nowrap;
}

.runs__thread {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.runs__muted {
  color: var(--color-text-muted);
  white-space: nowrap;
}

.runs__result--success {
  color: var(--color-status-success, #16a34a);
}

.runs__result--failed {
  color: var(--color-status-error);
}

.runs__result--skipped {
  color: var(--color-text-muted);
}

.runs__reason-text {
  margin-left: var(--space-1);
}

.runs__rebuilt {
  margin-left: var(--space-2);
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--color-primary-subtle);
  color: var(--color-primary);
  font-size: var(--font-size-xs);
}

.runs__hint,
.runs__error {
  padding: var(--space-3);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.runs__error {
  color: var(--color-status-error);
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
