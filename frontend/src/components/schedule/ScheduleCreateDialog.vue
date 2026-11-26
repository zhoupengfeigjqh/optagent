<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

import type { CreateScheduledTaskRequest, ScheduledTask } from '../../api/types'
import { formatDateTime } from '../../utils/schedule-format'
import BaseDialog from '../common/BaseDialog.vue'

const props = withDefaults(
  defineProps<{
    open?: boolean
    submitting?: boolean
    defaultThinking?: boolean
    task?: ScheduledTask | null
  }>(),
  { open: false, submitting: false, defaultThinking: false, task: null },
)

const isEdit = computed(() => props.task !== null)

const emit = defineEmits<{
  submit: [input: CreateScheduledTaskRequest]
  close: []
}>()

const uid = useId()
const fieldId = (name: string): string => `schedule-${name}-${uid}`

/** 与后端同一上限（`TASK_NAME_MAX`）——前端只用来提前提示，不做权威判定 */
const NAME_MAX = 50

const name = ref('')
const prompt = ref('')
const thinking = ref(false)
const startAt = ref('')
const intervalSeconds = ref('60')
const maxRuns = ref('10')
const deadlineAt = ref('')
const newThreadPerRun = ref(true)
const errors = ref<Record<string, string>>({})

function toLocalInput(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function resetForm(): void {
  const editing = props.task
  if (editing) {
    name.value = editing.name
    prompt.value = editing.prompt
    thinking.value = editing.thinking
    startAt.value = toLocalInput(new Date(editing.start_at))
    intervalSeconds.value = String(editing.interval_seconds)
    maxRuns.value = String(editing.max_runs)
    deadlineAt.value = toLocalInput(new Date(editing.deadline_at))
    newThreadPerRun.value = editing.new_thread_per_run
    errors.value = {}
    return
  }
  const now = Date.now()
  name.value = ''
  prompt.value = ''
  thinking.value = props.defaultThinking
  startAt.value = toLocalInput(new Date(now + 5 * 60_000))
  intervalSeconds.value = '60'
  maxRuns.value = '10'
  deadlineAt.value = toLocalInput(new Date(now + 7 * 86_400_000))
  newThreadPerRun.value = true
  errors.value = {}
}

watch(
  () => props.open,
  (open) => {
    if (open) resetForm()
  },
  { immediate: true },
)

const errorCount = computed(() => Object.keys(errors.value).length)

function parseLocal(value: string): number {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : Number.NaN
}

function validate(): CreateScheduledTaskRequest | null {
  const next: Record<string, string> = {}
  const trimmedName = name.value.trim()
  if (trimmedName === '') next.name = '请填写任务名称'
  else if ([...trimmedName].length > NAME_MAX) next.name = `任务名称不能超过 ${NAME_MAX} 个字符`

  const trimmedPrompt = prompt.value.trim()
  if (trimmedPrompt === '') next.prompt = '请填写任务提示词'

  const startMs = parseLocal(startAt.value)
  if (Number.isNaN(startMs)) next.start_at = '请选择执行开始时间'
  else if (!isEdit.value && startMs <= Date.now()) next.start_at = '开始时间必须晚于当前时间'

  const interval = Number(intervalSeconds.value)
  if (!Number.isInteger(interval) || interval < 1) {
    next.interval_seconds = '执行频率必须是不小于 1 的整数秒'
  }

  const runs = Number(maxRuns.value)
  if (!Number.isInteger(runs) || runs < 1) {
    next.max_runs = '执行次数必须是大于等于 1 的整数'
  }

  const deadlineMs = parseLocal(deadlineAt.value)
  if (Number.isNaN(deadlineMs)) next.deadline_at = '请选择有效截止时间'
  else if (!Number.isNaN(startMs) && deadlineMs <= startMs) {
    next.deadline_at = '有效截止时间必须晚于开始时间'
  }

  errors.value = next
  if (Object.keys(next).length > 0) return null
  return {
    name: trimmedName,
    prompt: trimmedPrompt,
    thinking: thinking.value,
    start_at: new Date(startMs).toISOString(),
    interval_seconds: interval,
    max_runs: runs,
    deadline_at: new Date(deadlineMs).toISOString(),
    new_thread_per_run: newThreadPerRun.value,
  }
}

function onSubmit(): void {
  if (props.submitting) return
  const input = validate()
  if (input === null) return
  emit('submit', input)
}

/** 开始时间变更后即时刷新"截止时间"的提示（不预填，避免替用户做决定） */
const deadlineHint = computed(() => {
  const startMs = parseLocal(startAt.value)
  if (Number.isNaN(startMs)) return ''
  return `必须晚于开始时间 ${formatDateTime(new Date(startMs).toISOString())}`
})
</script>

<template>
  <BaseDialog
    :open="open"
    :title="isEdit ? '编辑定时任务' : '创建定时任务'"
    @close="emit('close')"
  >
    <form class="schedule-form" novalidate @submit.prevent="onSubmit">
      <p v-if="errorCount > 0" class="schedule-form__summary" role="alert">
        有 {{ errorCount }} 处需要修改
      </p>

      <div class="schedule-form__field">
        <label :for="fieldId('name')">任务名称</label>
        <input
          :id="fieldId('name')"
          v-model="name"
          type="text"
          :maxlength="NAME_MAX"
          :disabled="submitting"
          :aria-invalid="errors.name ? 'true' : undefined"
          :aria-describedby="errors.name ? fieldId('name-error') : undefined"
        />
        <p v-if="errors.name" :id="fieldId('name-error')" class="schedule-form__error">
          {{ errors.name }}
        </p>
      </div>

      <div class="schedule-form__field">
        <label :for="fieldId('prompt')">任务提示词</label>
        <textarea
          :id="fieldId('prompt')"
          v-model="prompt"
          rows="4"
          :disabled="submitting"
          :aria-invalid="errors.prompt ? 'true' : undefined"
          :aria-describedby="errors.prompt ? fieldId('prompt-error') : fieldId('prompt-hint')"
        />
        <p :id="fieldId('prompt-hint')" class="schedule-form__hint">
          每轮执行时作为该会话的用户消息发出。
        </p>
        <p v-if="errors.prompt" :id="fieldId('prompt-error')" class="schedule-form__error">
          {{ errors.prompt }}
        </p>
      </div>

      <div class="schedule-form__field schedule-form__field--row">
        <input
          :id="fieldId('thinking')"
          v-model="thinking"
          type="checkbox"
          :disabled="submitting"
        />
        <label :for="fieldId('thinking')">启用深度思考</label>
      </div>

      <div class="schedule-form__field">
        <label :for="fieldId('start')">执行开始时间</label>
        <input
          :id="fieldId('start')"
          v-model="startAt"
          type="datetime-local"
          :disabled="submitting"
          :aria-invalid="errors.start_at ? 'true' : undefined"
          :aria-describedby="errors.start_at ? fieldId('start-error') : undefined"
        />
        <p v-if="errors.start_at" :id="fieldId('start-error')" class="schedule-form__error">
          {{ errors.start_at }}
        </p>
      </div>

      <div class="schedule-form__grid">
        <div class="schedule-form__field">
          <label :for="fieldId('interval')">执行频率（秒）</label>
          <input
            :id="fieldId('interval')"
            v-model="intervalSeconds"
            type="number"
            min="1"
            step="1"
            :disabled="submitting"
            :aria-invalid="errors.interval_seconds ? 'true' : undefined"
            :aria-describedby="errors.interval_seconds ? fieldId('interval-error') : undefined"
          />
          <p
            v-if="errors.interval_seconds"
            :id="fieldId('interval-error')"
            class="schedule-form__error"
          >
            {{ errors.interval_seconds }}
          </p>
        </div>

        <div class="schedule-form__field">
          <label :for="fieldId('runs')">执行次数</label>
          <input
            :id="fieldId('runs')"
            v-model="maxRuns"
            type="number"
            min="1"
            step="1"
            :disabled="submitting"
            :aria-invalid="errors.max_runs ? 'true' : undefined"
            :aria-describedby="errors.max_runs ? fieldId('runs-error') : undefined"
          />
          <p v-if="errors.max_runs" :id="fieldId('runs-error')" class="schedule-form__error">
            {{ errors.max_runs }}
          </p>
        </div>
      </div>

      <div class="schedule-form__field">
        <label :for="fieldId('deadline')">有效截止时间</label>
        <input
          :id="fieldId('deadline')"
          v-model="deadlineAt"
          type="datetime-local"
          :disabled="submitting"
          :aria-invalid="errors.deadline_at ? 'true' : undefined"
          :aria-describedby="fieldId('deadline-hint')"
        />
        <p :id="fieldId('deadline-hint')" class="schedule-form__hint">
          {{ errors.deadline_at || deadlineHint }}
        </p>
      </div>

      <div class="schedule-form__field schedule-form__field--row">
        <input
          :id="fieldId('new-thread')"
          v-model="newThreadPerRun"
          type="checkbox"
          :disabled="submitting || isEdit"
          aria-describedby="schedule-new-thread-hint"
        />
        <label :for="fieldId('new-thread')">每次任务创建新对话</label>
      </div>
      <p id="schedule-new-thread-hint" class="schedule-form__hint schedule-form__hint--indent">
        勾选：每轮执行新建一个会话；取消勾选：所有轮次都追加到同一个会话（会话被删除后会自动重建）。
        <template v-if="isEdit">会话模式在创建后不可修改；需要改变时请新建任务。</template>
        <template v-else>创建后不可修改。</template>
      </p>
    </form>

    <template #footer>
      <button type="button" class="schedule-form__button" :disabled="submitting" @click="emit('close')">
        取消
      </button>
      <button
        type="button"
        class="schedule-form__button schedule-form__button--primary"
        :disabled="submitting"
        @click="onSubmit"
      >
        {{ submitting ? (isEdit ? '保存中…' : '创建中…') : isEdit ? '保存' : '创建' }}
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.schedule-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.schedule-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.schedule-form__field--row {
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
}

.schedule-form__field label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.schedule-form__field input[type='text'],
.schedule-form__field input[type='number'],
.schedule-form__field input[type='datetime-local'],
.schedule-form__field textarea {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}

.schedule-form__field input[type='text']:focus-visible,
.schedule-form__field input[type='number']:focus-visible,
.schedule-form__field input[type='datetime-local']:focus-visible,
.schedule-form__field textarea:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.schedule-form__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.schedule-form__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.6;
}

.schedule-form__hint--indent {
  margin-left: var(--space-4);
}

.schedule-form__error {
  color: var(--color-status-error);
  font-size: var(--font-size-xs);
}

.schedule-form__summary {
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
}

.schedule-form__button {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}

.schedule-form__button--primary {
  border-color: transparent;
  background: var(--color-primary);
  color: var(--color-on-primary, #fff);
}

.schedule-form__button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
