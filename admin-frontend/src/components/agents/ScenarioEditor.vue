<script setup lang="ts">
/**
 * 文件空间场景编辑器（`FR-020`）。
 *
 * 场景＝**数字人级**（同一用户的不同数字人可有各自场景，看到不同文件空间），
 * 而三个空间下的**实际文件数据**仍是该用户共享的一份。
 *
 * 校验（前端即时提示 + 后端权威判定）：场景名非空；目录名拒绝空值 / 重复 /
 * 含路径分隔符 / `..`。
 *
 * 二级目录的**字段约束**（`data_prep_fields`）：新增目录后弹出确认窗口，
 * 也可经目录行的「字段(n)」入口再次编辑。配置只声明结构，校验在上传时由
 * 运行环境按上传表表头执行（本期未实现）。
 */
import { computed, ref } from 'vue'
import type { ScenarioField } from '../../api/types'
import ScenarioFieldDialog from './ScenarioFieldDialog.vue'

export interface ScenarioValue {
  scenario: string
  data_prep_dirs: string[]
  /** 目录 → 字段约束；无约束的目录不出现 */
  data_prep_fields: Record<string, ScenarioField[]>
}

const props = defineProps<{
  modelValue: ScenarioValue
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: ScenarioValue): void
}>()

const newDir = ref('')

/** 字段约束窗口：目录名单独持有（新增目录时 props 尚未回传，不能依赖 props 查） */
const fieldDialogOpen = ref(false)
const fieldDialogDir = ref('')
const editingFields = ref<ScenarioField[]>([])

/** 该目录当前的字段约束（缺失即"无约束"） */
function fieldsOf(dir: string): ScenarioField[] {
  return props.modelValue.data_prep_fields?.[dir] ?? []
}

function openFieldDialog(dir: string): void {
  fieldDialogDir.value = dir
  editingFields.value = fieldsOf(dir).map((field) => ({ ...field }))
  fieldDialogOpen.value = true
}

/**
 * 保存某目录的字段约束。
 *
 * 空列表 ⇒ **移除该目录的键**（"缺失即无约束"），不在设计态留空数组空壳。
 */
function saveFields(fields: ScenarioField[]): void {
  const dir = fieldDialogDir.value
  const next: Record<string, ScenarioField[]> = { ...(props.modelValue.data_prep_fields ?? {}) }
  if (fields.length > 0) next[dir] = fields
  else delete next[dir]
  emit('update:modelValue', { ...props.modelValue, data_prep_fields: next })
}

const scenarioError = computed(() => {
  const value = props.modelValue.scenario
  if (value.trim() === '') return '场景名必填'
  if (/[/\\]/.test(value) || value.includes('..')) return '场景名不得含路径分隔符或 ".."'
  return null
})

const dupDirs = computed(() => {
  const seen = new Set<string>()
  const dups = new Set<string>()
  for (const dir of props.modelValue.data_prep_dirs) {
    if (seen.has(dir)) dups.add(dir)
    seen.add(dir)
  }
  return [...dups]
})

function setScenario(value: string): void {
  emit('update:modelValue', { ...props.modelValue, scenario: value })
}

/**
 * 添加二级目录：**先入列**，再弹出字段约束窗口。
 *
 * 先入列是为了"取消/跳过不丢数据"——目录名已经生效，弹窗只是补字段约束。
 */
function addDir(): void {
  const value = newDir.value.trim()
  if (value === '') return
  if (props.modelValue.data_prep_dirs.includes(value)) {
    newDir.value = ''
    return
  }
  emit('update:modelValue', {
    ...props.modelValue,
    data_prep_dirs: [...props.modelValue.data_prep_dirs, value],
  })
  newDir.value = ''
  openFieldDialog(value)
}

/**
 * 移除目录：**同时移除其字段约束**（键是目录名，不清理会留下孤儿约束）。
 *
 * 只动配置，**不动文件系统**——被移除目录下的既有文件仍保留在用户空间。
 */
function removeDir(index: number): void {
  const dir = props.modelValue.data_prep_dirs[index]
  const nextDirs = props.modelValue.data_prep_dirs.filter((_, i) => i !== index)
  const nextFields: Record<string, ScenarioField[]> = { ...(props.modelValue.data_prep_fields ?? {}) }
  delete nextFields[dir]
  emit('update:modelValue', {
    ...props.modelValue,
    data_prep_dirs: nextDirs,
    data_prep_fields: nextFields,
  })
}
</script>

<template>
  <div class="scenario-editor">
    <label class="field" for="scenario-name">
      <span class="field__label">
        场景名<span class="field__required" aria-hidden="true">*</span>
      </span>
      <input
        id="scenario-name"
        type="text"
        :value="modelValue.scenario"
        :aria-invalid="scenarioError !== null"
        aria-describedby="scenario-name-hint"
        placeholder="例如：生产计划"
        @input="setScenario(($event.target as HTMLInputElement).value)"
      />
      <span id="scenario-name-hint" class="field__hint">
        <span v-if="scenarioError" class="scenario-editor__error">{{ scenarioError }}</span>
        <span v-else>场景随数字人存放，同一用户的不同数字人可有各自的可见目录。</span>
      </span>
    </label>

    <fieldset class="scenario-editor__dirs">
      <legend class="field__label">「数据准备」二级目录清单</legend>
      <p class="field__hint">
        仅这些子目录对数字人可见。**收缩清单不会删除已有文件**——被移除的目录及其内容仍保留在用户空间。
      </p>

      <ul v-if="modelValue.data_prep_dirs.length > 0" class="scenario-editor__list">
        <li v-for="(dir, index) in modelValue.data_prep_dirs" :key="`${dir}-${index}`">
          <span class="mono">{{ dir }}</span>
          <span class="scenario-editor__row-actions">
            <button
              type="button"
              class="btn"
              :data-test="`field-${dir}`"
              :aria-label="`编辑目录 ${dir} 的字段约束`"
              @click="openFieldDialog(dir)"
            >
              字段({{ fieldsOf(dir).length }})
            </button>
            <button
              type="button"
              class="btn"
              :aria-label="`移除目录 ${dir}`"
              @click="removeDir(index)"
            >
              移除
            </button>
          </span>
        </li>
      </ul>
      <p v-else class="field__hint">当前未配置二级目录（合法：表示不开放任何数据准备子目录）。</p>

      <div class="scenario-editor__add">
        <label class="visually-hidden" for="scenario-new-dir">新增二级目录名</label>
        <input
          id="scenario-new-dir"
          v-model="newDir"
          type="text"
          placeholder="输入二级目录名后回车添加"
          @keydown.enter.prevent="addDir"
        />
        <button type="button" class="btn" @click="addDir">添加目录</button>
      </div>

      <p v-if="dupDirs.length > 0" class="scenario-editor__error" role="alert">
        存在重复目录名：{{ dupDirs.join('、') }}
      </p>

      <p class="field__hint">
        每个目录可有各自的字段约束（上传表的表头校验用）：新增目录后立即弹出确认窗口，
        也可随时点目录行的「字段」按钮修改。未配置字段的目录不受约束。
      </p>
    </fieldset>

    <ScenarioFieldDialog
      v-model:open="fieldDialogOpen"
      :dir="fieldDialogDir"
      :fields="editingFields"
      @save="saveFields"
    />
  </div>
</template>

<style scoped>
.scenario-editor__dirs {
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.scenario-editor__list {
  margin: var(--space-2) 0;
  padding: 0;
  list-style: none;
}

.scenario-editor__list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
}

.scenario-editor__row-actions {
  display: inline-flex;
  gap: var(--space-2);
}

.scenario-editor__add {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.scenario-editor__error {
  color: var(--color-status-error);
}
</style>
