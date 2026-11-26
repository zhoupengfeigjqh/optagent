<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ScenarioField } from '../../api/types'
import { DEFAULT_DATA_PREP_UPLOADS, PREDEFINED_DATA_PREP_DIRS } from '../../constants/agent-design'
import ScenarioFieldDialog from './ScenarioFieldDialog.vue'
import ScenarioUploadTypesDialog from './ScenarioUploadTypesDialog.vue'

export interface ScenarioValue {
  scenario: string
  data_prep_dirs: string[]
  data_prep_fields: Record<string, ScenarioField[]>
  data_prep_uploads?: Record<string, string[]>
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

const uploadDialogOpen = ref(false)
const uploadDialogDir = ref('')
const editingUploads = ref<string[]>([])

function fieldsOf(dir: string): ScenarioField[] {
  return props.modelValue.data_prep_fields?.[dir] ?? []
}

function uploadsOf(dir: string): string[] {
  return props.modelValue.data_prep_uploads?.[dir] ?? []
}

function uploadCountOf(dir: string): number {
  const configured = uploadsOf(dir)
  return configured.length > 0 ? configured.length : DEFAULT_DATA_PREP_UPLOADS.length
}

function openUploadDialog(dir: string): void {
  uploadDialogDir.value = dir
  editingUploads.value = [...uploadsOf(dir)]
  uploadDialogOpen.value = true
}

/**
 * 保存某目录的可上传类型。
 *
 * 空列表 ⇒ **移除该目录的键**（"缺失即用平台默认"），不在设计态留空数组空壳。
 * 组件层已保证"至少一项"，此处再兜底一次。
 */
function saveUploads(extensions: string[]): void {
  const dir = uploadDialogDir.value
  const next: Record<string, string[]> = { ...(props.modelValue.data_prep_uploads ?? {}) }
  if (extensions.length > 0) next[dir] = extensions
  else delete next[dir]
  emit('update:modelValue', { ...props.modelValue, data_prep_uploads: next })
}

/**
 * 预定义目录（平台硬编码）：不可**删除**，但可**屏蔽**（2026-11-17）。
 *
 * 屏蔽 = 从 `data_prep_dirs` 移除（清单即数字人的可见范围），不强制字段约束。
 */
function isPredefined(dir: string): boolean {
  return (PREDEFINED_DATA_PREP_DIRS as readonly string[]).includes(dir)
}

const blockedDirs = computed(() =>
  (PREDEFINED_DATA_PREP_DIRS as readonly string[]).filter(
    (dir) => !props.modelValue.data_prep_dirs.includes(dir),
  ),
)

function openFieldDialog(dir: string): void {
  fieldDialogDir.value = dir
  editingFields.value = fieldsOf(dir).map((field) => ({ ...field }))
  fieldDialogOpen.value = true
}

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
 * 移除目录：**同时移除其字段约束与可上传类型配置**（键是目录名，不清理会留下孤儿键）。
 *
 * 只动配置，**不动文件系统**——被移除目录下的既有文件仍保留在用户空间。
 * 预定义目录不走这里：它不可删除，只能「屏蔽」（见 `blockPredefined`）。
 */
function removeDir(index: number): void {
  const dir = props.modelValue.data_prep_dirs[index]
  if (isPredefined(dir)) return
  const nextDirs = props.modelValue.data_prep_dirs.filter((_, i) => i !== index)
  const nextFields: Record<string, ScenarioField[]> = {
    ...(props.modelValue.data_prep_fields ?? {}),
  }
  delete nextFields[dir]
  const nextUploads: Record<string, string[]> = { ...(props.modelValue.data_prep_uploads ?? {}) }
  delete nextUploads[dir]
  emit('update:modelValue', {
    ...props.modelValue,
    data_prep_dirs: nextDirs,
    data_prep_fields: nextFields,
    data_prep_uploads: nextUploads,
  })
}

/**
 * 屏蔽预定义目录（2026-11-17）：从清单移除，**同时清掉**该目录的字段约束与可上传类型。
 *
 * 为什么清键：平台把"清单外目录的配置"判为孤儿键（保存与部署预检都会拒绝），
 * 保留就会让设计态保存不过。代价是重新启用后需重配——界面文案已写明。
 * 只动配置，**不动文件系统**：已上传的文件仍保留，重新启用即恢复可见。
 */
function blockPredefined(dir: string): void {
  if (!isPredefined(dir)) return
  const nextFields: Record<string, ScenarioField[]> = {
    ...(props.modelValue.data_prep_fields ?? {}),
  }
  delete nextFields[dir]
  const nextUploads: Record<string, string[]> = { ...(props.modelValue.data_prep_uploads ?? {}) }
  delete nextUploads[dir]
  emit('update:modelValue', {
    ...props.modelValue,
    data_prep_dirs: props.modelValue.data_prep_dirs.filter((item) => item !== dir),
    data_prep_fields: nextFields,
    data_prep_uploads: nextUploads,
  })
}

function enablePredefined(dir: string): void {
  if (!isPredefined(dir) || props.modelValue.data_prep_dirs.includes(dir)) return
  emit('update:modelValue', {
    ...props.modelValue,
    data_prep_dirs: [...props.modelValue.data_prep_dirs, dir],
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
        仅这些子目录对数字人可见。「算法规则」为平台预定义目录，不可删除但可屏蔽：屏蔽后该目录
        不会出现在用户文件空间，也不会被数字人读取；已上传的文件仍保留，随时可重新启用。
        「移除」自定义目录同样不删除已有文件。
      </p>

      <ul v-if="modelValue.data_prep_dirs.length > 0" class="scenario-editor__list">
        <li v-for="(dir, index) in modelValue.data_prep_dirs" :key="`${dir}-${index}`">
          <span class="mono">{{ dir }}</span>
          <span
            v-if="isPredefined(dir)"
            class="scenario-editor__badge"
            data-test="predefined-badge"
          >
            预定义
          </span>
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
              :data-test="`upload-types-${dir}`"
              :aria-label="`配置目录 ${dir} 的可上传文件类型`"
              @click="openUploadDialog(dir)"
            >
              文件类型({{ uploadCountOf(dir) }})
            </button>
            <button
              v-if="!isPredefined(dir)"
              type="button"
              class="btn"
              :aria-label="`移除目录 ${dir}`"
              @click="removeDir(index)"
            >
              移除
            </button>
            <button
              v-else
              type="button"
              class="btn"
              :data-test="`block-${dir}`"
              :aria-label="`屏蔽目录 ${dir}`"
              @click="blockPredefined(dir)"
            >
              屏蔽
            </button>
          </span>
        </li>
      </ul>
      <p v-else class="field__hint">
        当前清单为空：数字人的「数据准备」空间不会显示任何二级目录（已上传的文件仍保留）。
      </p>

      <div v-if="blockedDirs.length > 0" class="scenario-editor__blocked">
        <p class="field__label">已屏蔽的预定义目录</p>
        <ul class="scenario-editor__list">
          <li v-for="dir in blockedDirs" :key="`blocked-${dir}`">
            <span class="mono scenario-editor__blocked-name">{{ dir }}</span>
            <span class="scenario-editor__badge" data-test="blocked-badge">已屏蔽</span>
            <span class="scenario-editor__row-actions">
              <button
                type="button"
                class="btn"
                :data-test="`enable-${dir}`"
                :aria-label="`启用目录 ${dir}`"
                @click="enablePredefined(dir)"
              >
                启用
              </button>
            </span>
          </li>
        </ul>
        <p class="field__hint">
          启用后重新出现在数字人的文件空间；屏蔽时已清空的字段约束与可上传类型需重新配置。
        </p>
      </div>

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

      <p class="field__hint">
        每个目录还可各自限定**可上传的文件类型**：点目录行的「文件类型」按钮配置，至少选一项；
        未配置时使用平台默认（.csv 与 .xlsx）。共享空间与临时空间不受此配置影响。
      </p>
    </fieldset>

    <ScenarioFieldDialog
      v-model:open="fieldDialogOpen"
      :dir="fieldDialogDir"
      :fields="editingFields"
      @save="saveFields"
    />

    <ScenarioUploadTypesDialog
      v-model:open="uploadDialogOpen"
      :dir="uploadDialogDir"
      :extensions="editingUploads"
      @save="saveUploads"
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

.scenario-editor__badge {
  margin-left: var(--space-2);
  padding: 0 var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.scenario-editor__add {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.scenario-editor__error {
  color: var(--color-status-error);
}

.scenario-editor__blocked {
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px dashed var(--color-border);
}

.scenario-editor__blocked-name {
  color: var(--color-text-muted);
}
</style>
