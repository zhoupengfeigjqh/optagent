<script setup lang="ts">
/**
 * SKILL 选择器（`FR-018`、`FR-019`）。
 *
 * 数字人**按名称引用** SKILL，MUST NOT 内嵌技能正文——正文由共享技能库物化，
 * 因此"库中改了正文 → 下次部署同步生效"（`SC-009`），无需逐个改数字人。
 */
import { computed } from 'vue'
import type { SkillListItem } from '../../api/types'
import CheckboxList from '../common/CheckboxList.vue'
import type { CheckboxOption } from '../common/checkbox-option'

const props = defineProps<{
  skills: SkillListItem[]
  modelValue: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const options = computed<CheckboxOption[]>(() =>
  props.skills.map((skill) => ({
    value: skill.name,
    label: skill.name,
    description: skill.description,
  })),
)

const known = computed(() => new Set(props.skills.map((s) => s.name)))
const orphans = computed(() => props.modelValue.filter((name) => !known.value.has(name)))
</script>

<template>
  <CheckboxList
    legend="引用的 SKILL（共享技能库）"
    :options="options"
    :model-value="modelValue"
    :orphans="orphans"
    search-placeholder="按技能名或描述搜索…"
    empty-text="共享技能库为空（可在 SKILL 管理功能区内上传安装）"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
