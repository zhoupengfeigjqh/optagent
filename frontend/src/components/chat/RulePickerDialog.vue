<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { RuleFileResponse } from '../../api/types'
import BaseButton from '../common/BaseButton.vue'
import BaseDialog from '../common/BaseDialog.vue'
import HintTip from '../common/HintTip.vue'

const props = defineProps<{
  open: boolean
  fieldName: string
  initialValue: unknown
  load: () => Promise<RuleFileResponse>
}>()

const emit = defineEmits<{
  confirm: [value: Array<Record<string, unknown>>]
  close: []
}>()

const data = ref<RuleFileResponse | null>(null)
const loading = ref(false)
const error = ref('')
const checked = ref<Set<number>>(new Set())
const priorityDrafts = ref<Record<number, string>>({})

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as Record<string, unknown>)
  const kb = Object.keys(b as Record<string, unknown>)
  if (ka.length !== kb.length) return false
  return ka.every(
    (k) =>
      k in (b as Record<string, unknown>) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    data.value = null
    error.value = ''
    checked.value = new Set()
    priorityDrafts.value = {}
    loading.value = true
    props
      .load()
      .then((result) => {
        data.value = result
        if (Array.isArray(props.initialValue)) {
          const next = new Set<number>()
          result.rows.forEach((row, index) => {
            if ((props.initialValue as unknown[]).some((item) => deepEqual(item, row)))
              next.add(index)
          })
          checked.value = next
        }
        if (result.priority_column) {
          const drafts: Record<number, string> = {}
          result.rows.forEach((row, index) => {
            const value = row[result.priority_column!]
            drafts[index] = value === null || value === undefined ? '' : String(value)
          })
          priorityDrafts.value = drafts
        }
      })
      .catch((err: unknown) => {
        error.value = err instanceof Error ? err.message : String(err)
      })
      .finally(() => {
        loading.value = false
      })
  },
  { immediate: true },
)

function toggle(index: number): void {
  const next = new Set(checked.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  checked.value = next
}

function cellText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

const canConfirm = computed(() => checked.value.size > 0)

function draftValue(draft: string): number | string | undefined {
  const trimmed = draft.trim()
  if (trimmed === '') return undefined
  const numeric = Number(trimmed)
  return Number.isFinite(numeric) && trimmed !== '' ? numeric : trimmed
}

const hintText = computed(
  () =>
    `勾选需要的规则；「${data.value?.priority_column ?? '优先级'}」列可就地调整，留空则不携带该字段。`,
)

function onConfirm(): void {
  if (!data.value || !canConfirm.value) return
  const priorityColumn = data.value.priority_column
  const value: Array<Record<string, unknown>> = []
  for (const index of [...checked.value].sort((a, b) => a - b)) {
    const row = { ...data.value.rows[index]! }
    if (priorityColumn) {
      const parsed = draftValue(priorityDrafts.value[index] ?? '')
      if (parsed === undefined) delete row[priorityColumn]
      else row[priorityColumn] = parsed
    }
    value.push(row)
  }
  emit('confirm', value)
}
</script>

<template>
  <BaseDialog :open="open" title="从算法规则选择" @close="emit('close')">
    <div class="rule-picker">
      <p class="rule-picker__meta">
        参数 <code class="mono">{{ fieldName }}</code>
        <template v-if="data">· 来源：{{ data.filename }}</template>
        <HintTip :text="hintText" label="查看操作说明" />
      </p>

      <p v-if="loading" class="rule-picker__state">正在读取最新规则文件…</p>
      <p v-else-if="error" class="rule-picker__state rule-picker__state--error">{{ error }}</p>
      <p v-else-if="data && data.rows.length === 0" class="rule-picker__state">
        规则文件「{{ data.filename }}」没有数据行。
      </p>

      <div v-else-if="data" class="rule-picker__table-wrap">
        <table class="rule-picker__table">
          <thead>
            <tr>
              <th class="rule-picker__check-col" aria-label="选择" />
              <th v-for="column in data.columns" :key="column">{{ column }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in data.rows" :key="index">
              <td class="rule-picker__check-col">
                <input
                  type="checkbox"
                  :aria-label="`选择规则第 ${index + 1} 行`"
                  :checked="checked.has(index)"
                  @change="toggle(index)"
                />
              </td>
              <td v-for="column in data.columns" :key="column">
                <input
                  v-if="column === data.priority_column"
                  v-model="priorityDrafts[index]"
                  type="text"
                  class="rule-picker__priority-input"
                  :aria-label="`第 ${index + 1} 行 ${column}`"
                />
                <template v-else>{{ cellText(row[column]) }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <template #footer>
      <BaseButton variant="secondary" @click="emit('close')">取消</BaseButton>
      <BaseButton variant="primary" :disabled="!canConfirm" @click="onConfirm">
        确认选择（{{ checked.size }}）
      </BaseButton>
    </template>
  </BaseDialog>
</template>

<style scoped>
.rule-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.rule-picker__meta {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.rule-picker__state {
  margin: 0;
  padding: var(--space-4);
  text-align: center;
  color: var(--color-text-muted);
}

.rule-picker__state--error {
  color: var(--color-status-error);
}

.rule-picker__table-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.rule-picker__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.rule-picker__table th,
.rule-picker__table td {
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  white-space: nowrap;
}

.rule-picker__table tbody tr:last-child td {
  border-bottom: none;
}

.rule-picker__table th {
  background: var(--color-bg-subtle);
  font-weight: 600;
}

.rule-picker__check-col {
  width: 32px;
  text-align: center;
}

.rule-picker__priority-input {
  width: 64px;
  padding: 0 var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font: inherit;
}
</style>
