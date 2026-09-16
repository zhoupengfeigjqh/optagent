<script setup lang="ts">
/**
 * 文件空间场景编辑器（`FR-020`）。
 *
 * 场景＝**数字人级**（同一用户的不同数字人可有各自场景，看到不同文件空间），
 * 而三个空间下的**实际文件数据**仍是该用户共享的一份。
 *
 * 校验（前端即时提示 + 后端权威判定）：场景名非空；目录名拒绝空值 / 重复 /
 * 含路径分隔符 / `..`。
 */
import { computed, ref } from 'vue'

export interface ScenarioValue {
  scenario: string
  data_prep_dirs: string[]
}

const props = defineProps<{
  modelValue: ScenarioValue
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: ScenarioValue): void
}>()

const newDir = ref('')

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
}

function removeDir(index: number): void {
  const next = props.modelValue.data_prep_dirs.filter((_, i) => i !== index)
  emit('update:modelValue', { ...props.modelValue, data_prep_dirs: next })
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
          <button
            type="button"
            class="btn"
            :aria-label="`移除目录 ${dir}`"
            @click="removeDir(index)"
          >
            移除
          </button>
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
    </fieldset>
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

.scenario-editor__add {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.scenario-editor__error {
  color: var(--color-status-error);
}
</style>
