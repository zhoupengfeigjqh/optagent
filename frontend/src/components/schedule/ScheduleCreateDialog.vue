<script setup lang="ts">
/**
 * 定时任务表单弹窗（015，T039 / T064；2026-10-30 增补编辑模式）
 *
 * 8 项输入：名称、提示词、思考开关、开始时间、间隔秒数、执行次数、截止时间、
 * **会话模式复选框「每次任务创建新对话」**（默认勾选）。
 *
 * 四条硬口径：
 * 1. **校验文案与后端 `data-model.md` §6 同一套**：前端先拦是为了不浪费一次往返，
 *    但服务端仍是权威（同名冲突、秒级时间比较只有它能判）。
 * 2. **思考开关的默认值由 props 注入**（来自聊天区当前值，`FR-026`）：本组件不自己去读
 *    聊天状态——弹窗不该依赖聊天 store，否则无法在设置页之外复用、也无法单测。
 * 3. **失败保留已填内容**：`submitting` 只置灰不重置；关闭后再打开才回到默认值。
 * 4. **编辑模式（`task` 非空）复用同一套表单与校验**：预填现有配置、会话模式只读
 *    （`FR-060`），并且**允许开始时间已过去**——编辑只改配置，下次生效时刻由服务端
 *    在启用时推进（`FR-045` 同口径）；否则"只改个名字"会被开始时间已过挡住。
 */
import { computed, ref, useId, watch } from 'vue'

import type { CreateScheduledTaskRequest, ScheduledTask } from '../../api/types'
import { formatDateTime } from '../../utils/schedule-format'
import BaseDialog from '../common/BaseDialog.vue'

const props = withDefaults(
  defineProps<{
    open?: boolean
    /** 提交中：所有控件与按钮禁用（防重复提交），内容保留 */
    submitting?: boolean
    /** 思考开关默认值（来自聊天区当前值） */
    defaultThinking?: boolean
    /** 非空 = 编辑该任务；为空 = 新建（同一套表单，两种标题与文案） */
    task?: ScheduledTask | null
  }>(),
  { open: false, submitting: false, defaultThinking: false, task: null },
)

/** 编辑模式：标题、主按钮文案、会话模式只读，都从这里派生 */
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

/** `Date` → `datetime-local` 需要的本地 `YYYY-MM-DDTHH:mm` */
function toLocalInput(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

/**
 * 打开时重置表单。
 *
 * - 新建：开始时间给"5 分钟后"、截止给"7 天后"、思考开关继承聊天区、会话模式勾选；
 * - 编辑：整体预填该任务的现有配置（会话模式只读，但仍同步到本地以保持展示一致）。
 */
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

/** 表单错误数（供无障碍播报"共 N 处需要修改"） */
const errorCount = computed(() => Object.keys(errors.value).length)

function parseLocal(value: string): number {
  // `datetime-local` 无时区：交给 `Date` 按本地时区解析，与服务端"本地展示"口径一致
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : Number.NaN
}

/** 逐字段校验；返回可直接提交的请求体，或 `null`（错误已写入 `errors`） */
function validate(): CreateScheduledTaskRequest | null {
  const next: Record<string, string> = {}
  const trimmedName = name.value.trim()
  if (trimmedName === '') next.name = '请填写任务名称'
  else if ([...trimmedName].length > NAME_MAX) next.name = `任务名称不能超过 ${NAME_MAX} 个字符`

  const trimmedPrompt = prompt.value.trim()
  if (trimmedPrompt === '') next.prompt = '请填写任务提示词'

  const startMs = parseLocal(startAt.value)
  if (Number.isNaN(startMs)) next.start_at = '请选择执行开始时间'
  // 编辑不改"生效起点"的语义：已过去的开始时间合法（启用时由服务端推进到未来）
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
