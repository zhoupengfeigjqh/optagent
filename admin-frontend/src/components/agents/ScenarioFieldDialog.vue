<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { SCENARIO_FIELD_TYPES, type ScenarioField, type ScenarioFieldType } from '../../api/types'

const props = defineProps<{
  open: boolean
  dir: string
  fields: ScenarioField[]
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'save', fields: ScenarioField[]): void
}>()

const TYPE_OPTIONS: Array<{ value: ScenarioFieldType; label: string }> = [
  { value: 'string', label: 'string（文本）' },
  { value: 'integer', label: 'integer（整数）' },
  { value: 'number', label: 'number（数值）' },
  { value: 'boolean', label: 'boolean（布尔）' },
  { value: 'object', label: 'object（对象 JSON）' },
  { value: 'array', label: 'array（数组 JSON）' },
]

const rows = ref<ScenarioField[]>([])
const dialogEl = ref<HTMLDialogElement | null>(null)
let restoreFocusTo: HTMLElement | null = null

const errors = computed<string[]>(() => {
  const out: string[] = []
  const seen = new Set<string>()
  rows.value.forEach((row, index) => {
    const name = row.name
    if (name.trim() === '') {
      out.push(`第 ${index + 1} 行：字段名必填`)
      return
    }
    if (name.length > 64 || /[/\\]/.test(name) || name.includes('..')) {
      out.push(`第 ${index + 1} 行：字段名不得含路径分隔符或 “..”，且不超过 64 字符`)
      return
    }
    if (seen.has(name)) {
      out.push(`第 ${index + 1} 行：字段名重复：${name}`)
      return
    }
    seen.add(name)
  })
  return out
})

const canSave = computed(() => errors.value.length === 0)

function addRow(): void {
  rows.value.push({ name: '', type: SCENARIO_FIELD_TYPES[0], required: true })
}

function removeRow(index: number): void {
  rows.value.splice(index, 1)
}

function openDialog(): void {
  const el = dialogEl.value
  if (!el) return
  restoreFocusTo = (document.activeElement as HTMLElement | null) ?? null
  // jsdom 早期版本没有 showModal：降级为设置 open 属性，保证行为可测
  if (typeof el.showModal === 'function') {
    if (!el.open) el.showModal()
  } else {
    el.setAttribute('open', '')
  }
}

function closeDialog(): void {
  const el = dialogEl.value
  if (el) {
    if (typeof el.close === 'function' && el.open) el.close()
    else el.removeAttribute('open')
  }
  restoreFocusTo?.focus?.()
  restoreFocusTo = null
}

function requestClose(): void {
  emit('update:open', false)
}

function onSave(): void {
  if (!canSave.value) return
  emit(
    'save',
    rows.value.map((row) => ({ ...row })),
  )
  emit('update:open', false)
}

function onCancel(event: Event): void {
  event.preventDefault()
  requestClose()
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) rows.value = props.fields.map((field) => ({ ...field }))
    await nextTick()
    if (isOpen) openDialog()
    else closeDialog()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  const el = dialogEl.value
  if (el && typeof el.close === 'function' && el.open) el.close()
})
</script>

<template>
  <dialog
    ref="dialogEl"
    class="field-dialog"
    data-test="scenario-field-dialog"
    aria-labelledby="scenario-field-dialog-title"
    @cancel="onCancel"
  >
    <form method="dialog" class="field-dialog__body" @submit.prevent>
      <h2 id="scenario-field-dialog-title" class="field-dialog__title">字段约束确认：{{ dir }}</h2>
      <p class="field-dialog__hint">
        这些字段将在上传文件到该目录时，按上传表的表头校验：必填字段必须存在，且取值类型须匹配。
        字段列表为空即该目录不设约束。
      </p>

      <ul v-if="rows.length > 0" class="field-dialog__list">
        <li v-for="(row, index) in rows" :key="index" class="field-dialog__row">
          <label class="visually-hidden" :for="`scenario-field-name-${index}`">
            第 {{ index + 1 }} 个字段名
          </label>
          <input
            :id="`scenario-field-name-${index}`"
            v-model="row.name"
            type="text"
            class="field-dialog__name"
            placeholder="字段名（表头名）"
          />

          <label class="visually-hidden" :for="`scenario-field-type-${index}`">
            第 {{ index + 1 }} 个字段的取值类型
          </label>
          <select
            :id="`scenario-field-type-${index}`"
            v-model="row.type"
            class="field-dialog__type"
          >
            <option v-for="option in TYPE_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>

          <label class="field-dialog__required">
            <input v-model="row.required" type="checkbox" />
            必填
          </label>

          <button
            type="button"
            class="btn"
            :aria-label="`移除字段 ${row.name === '' ? index + 1 : row.name}`"
            @click="removeRow(index)"
          >
            移除
          </button>
        </li>
      </ul>
      <p v-else class="field-dialog__empty" data-test="no-fields">
        未配置字段：该目录不设字段约束（上传时不校验）。
      </p>

      <button type="button" class="btn" data-test="add-field" @click="addRow">添加字段</button>

      <p v-for="message in errors" :key="message" class="field-dialog__error" role="alert">
        {{ message }}
      </p>

      <div class="field-dialog__actions">
        <button type="button" class="btn" data-test="cancel" @click="requestClose">取消</button>
        <button
          type="button"
          class="btn btn--primary"
          data-test="save"
          :disabled="!canSave"
          @click="onSave"
        >
          保存
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.field-dialog {
  border: none;
  border-radius: var(--radius-lg);
  padding: 0;
  max-width: 640px;
  width: calc(100% - var(--space-6));
  box-shadow: 0 12px 32px rgb(15 20 30 / 24%);
  z-index: var(--z-index-dialog);
}

.field-dialog::backdrop {
  background: var(--color-overlay);
}

.field-dialog__body {
  padding: var(--space-5);
}

.field-dialog__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.field-dialog__hint,
.field-dialog__empty {
  margin: var(--space-2) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}

.field-dialog__list {
  margin: var(--space-3) 0;
  padding: 0;
  list-style: none;
}

.field-dialog__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--color-border);
}

.field-dialog__name,
.field-dialog__type {
  flex: 1 1 0;
  width: auto;
}

.field-dialog__name {
  /* 不用 `min-width: 0`：那会让输入框被压到 0，至少保留"看得清在输入什么"的下限 */
  min-width: 6rem;
}

/* 类型下拉的选项文字最长约 "integer（整数）"，给个下限避免窄屏下折行 */
.field-dialog__type {
  min-width: 9rem;
}

.field-dialog__required,
.field-dialog__row .btn {
  flex: 0 0 auto;
}

.field-dialog__required {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

.field-dialog__error {
  margin: var(--space-2) 0 0;
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
}

.field-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>
