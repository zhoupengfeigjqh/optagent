<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type {
  CreateScheduledTaskRequest,
  ErrorInfo,
  ScheduledTask,
  ScheduleRun,
  UpdateScheduledTaskRequest,
} from '../../api/types'
import BaseIcon from '../common/BaseIcon.vue'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ScheduleCreateDialog from './ScheduleCreateDialog.vue'
import ScheduleRunsDialog from './ScheduleRunsDialog.vue'
import ScheduleTable from './ScheduleTable.vue'

const props = withDefaults(
  defineProps<{
    open?: boolean
    tasks?: ScheduledTask[]
    loading?: boolean
    error?: ErrorInfo | null
    /** 变更信号已降级（重连用尽）：提示可手动刷新 */
    degraded?: boolean
    pendingIds?: readonly string[]
    submitting?: boolean
    defaultThinking?: boolean
    runs?: ScheduleRun[]
    runsTotal?: number
    runsLoading?: boolean
    runsError?: ErrorInfo | null
    createTask?: (input: CreateScheduledTaskRequest) => Promise<boolean>
    removeTask?: (taskId: string) => Promise<boolean>
    updateTask?: (taskId: string, input: UpdateScheduledTaskRequest) => Promise<boolean>
  }>(),
  {
    open: false,
    tasks: () => [],
    loading: false,
    error: null,
    degraded: false,
    pendingIds: () => [],
    submitting: false,
    defaultThinking: false,
    runs: () => [],
    runsTotal: 0,
    runsLoading: false,
    runsError: null,
    createTask: undefined,
    removeTask: undefined,
    updateTask: undefined,
  },
)

const emit = defineEmits<{
  close: []
  toggle: [payload: { taskId: string; enabled: boolean }]
  reload: []
  'load-runs': [taskId: string | null]
  'open-thread': [threadId: string]
}>()

const dialogRef = ref<HTMLDialogElement | null>(null)
const createOpen = ref(false)
const editing = ref<ScheduledTask | null>(null)
const runsOpen = ref(false)
const runsFilter = ref<string | null>(null)
const pendingDelete = ref<ScheduledTask | null>(null)

const formOpen = computed(() => createOpen.value || editing.value !== null)

const deleteMessage = computed(() => {
  const target = pendingDelete.value
  if (!target) return ''
  return `删除后该任务不再触发，已产生的会话与历史消息**保留**。\n确定要删除「${target.name}」吗？`
})

function syncOpen(value: boolean): void {
  const dialog = dialogRef.value
  if (!dialog) return
  if (value) {
    if (!dialog.open) dialog.showModal?.()
    return
  }
  if (dialog.open) dialog.close?.()
}

watch(() => props.open, syncOpen, { immediate: true })

function onCancel(event: Event): void {
  // 阻止原生关闭：父级更新 `open` 后经 `watch` 统一收敛，避免状态两处各改一次
  event.preventDefault()
  emit('close')
}

function closePanel(): void {
  // 关覆盖层时一并收起子弹窗，避免"下次打开还停在弹窗里"
  createOpen.value = false
  editing.value = null
  runsOpen.value = false
  pendingDelete.value = null
  emit('close')
}

/** 关表单弹窗：创建态与编辑态一起清，避免"下次打开还停在编辑某一行" */
function closeForm(): void {
  createOpen.value = false
  editing.value = null
}

function onStartEdit(taskId: string): void {
  editing.value = props.tasks.find((task) => task.task_id === taskId) ?? null
}

function onOpenRuns(): void {
  runsOpen.value = true
  emit('load-runs', runsFilter.value)
}

function onFilter(taskId: string | null): void {
  runsFilter.value = taskId
  emit('load-runs', taskId)
}

async function onConfirmDelete(): Promise<void> {
  const target = pendingDelete.value
  if (!target) return
  pendingDelete.value = null
  // 乐观移除与回滚都在 store；失败时列表里会"长回来"，同时弹 toast 说明原因
  await props.removeTask?.(target.task_id)
}

/**
 * 表单提交（创建 / 编辑分流）。
 *
 * 编辑必须**逐项挑出可编辑字段**：服务端对 `PATCH :id` 的请求体开了"未声明字段一律 400"，
 * 而表单的提交形状带着 `new_thread_per_run`（创建时才合法）。整份透传会被 400 打回来。
 */
async function onFormSubmit(input: CreateScheduledTaskRequest): Promise<void> {
  const target = editing.value
  if (target) {
    const editable: UpdateScheduledTaskRequest = {
      name: input.name,
      prompt: input.prompt,
      thinking: input.thinking,
      start_at: input.start_at,
      interval_seconds: input.interval_seconds,
      max_runs: input.max_runs,
      deadline_at: input.deadline_at,
    }
    const ok = (await props.updateTask?.(target.task_id, editable)) ?? false
    if (ok) closeForm()
    return
  }
  const ok = (await props.createTask?.(input)) ?? false
  if (ok) closeForm()
}

function onOpenThread(threadId: string): void {
  emit('open-thread', threadId)
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      createOpen.value = false
      editing.value = null
      runsOpen.value = false
      pendingDelete.value = null
    }
    if (typeof document === 'undefined') return
    document.body.style.overflow = open ? 'hidden' : ''
  },
)

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})
</script>

<template>
  <dialog
    ref="dialogRef"
    class="schedule-panel"
    aria-labelledby="schedule-panel-title"
    @cancel="onCancel"
  >
    <header class="schedule-panel__header">
      <h2 id="schedule-panel-title" class="schedule-panel__title">定时任务</h2>

      <div class="schedule-panel__actions">
        <button type="button" class="schedule-panel__button" @click="onOpenRuns">
          运行记录
        </button>
        <button
          type="button"
          class="schedule-panel__button schedule-panel__button--primary"
          @click="createOpen = true"
        >
          创建定时任务
        </button>
        <button
          type="button"
          class="schedule-panel__close"
          aria-label="关闭定时任务设置"
          @click="closePanel"
        >
          <BaseIcon name="close" :size="18" />
        </button>
      </div>
    </header>

    <p v-if="degraded" class="schedule-panel__degraded" role="status">
      实时更新已暂停（连接重试已达上限）。
      <button type="button" class="schedule-panel__link" @click="emit('reload')">手动刷新</button>
    </p>

    <div class="schedule-panel__body">
      <ScheduleTable
        :tasks="tasks"
        :pending-ids="pendingIds"
        :loading="loading"
        :error="error"
        @toggle="emit('toggle', $event)"
        @edit="onStartEdit"
        @remove="pendingDelete = tasks.find((task) => task.task_id === $event) ?? null"
        @create="createOpen = true"
        @reload="emit('reload')"
      />
    </div>

    <ScheduleCreateDialog
      :open="formOpen"
      :task="editing"
      :submitting="submitting"
      :default-thinking="defaultThinking"
      @submit="onFormSubmit"
      @close="closeForm"
    />

    <ScheduleRunsDialog
      :open="runsOpen"
      :runs="runs"
      :total="runsTotal"
      :loading="runsLoading"
      :error="runsError"
      :tasks="tasks"
      :filter-task-id="runsFilter"
      @filter="onFilter"
      @reload="emit('load-runs', runsFilter)"
      @open-thread="onOpenThread"
      @close="runsOpen = false"
    />

    <ConfirmDialog
      :open="pendingDelete !== null"
      title="删除定时任务"
      :message="deleteMessage"
      confirm-label="删除"
      danger
      @confirm="onConfirmDelete"
      @cancel="pendingDelete = null"
    />
  </dialog>
</template>

<style scoped>
.schedule-panel {
  /* 铺满视口：`inset: 0` 等价写法。MUST 显式清零 margin —— Tailwind preflight 的
     `* { margin: 0 }` 会压过 UA 给 dialog 的 `margin: auto`（与 `BaseDialog` 同一坑）。 */
  margin: 0;
  width: 100vw;
  max-width: none;
  height: 100vh;
  max-height: none;
  padding: 0;
  border: none;
  background: var(--color-surface);
  color: var(--color-text);
}

.schedule-panel::backdrop {
  background: var(--color-overlay);
}

.schedule-panel__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.schedule-panel__title {
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.schedule-panel__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}

.schedule-panel__button {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}

.schedule-panel__button--primary {
  border-color: transparent;
  background: var(--color-primary);
  color: var(--color-on-primary, #fff);
}

.schedule-panel__close {
  display: inline-flex;
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.schedule-panel__close:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.schedule-panel__degraded {
  margin: 0;
  padding: var(--space-2) var(--space-4);
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.schedule-panel__link {
  border: none;
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.schedule-panel__body {
  height: calc(100vh - 56px);
  overflow: auto;
  padding: var(--space-3) var(--space-4);
}
</style>
