<script setup lang="ts">
import { computed } from 'vue'
import type { SkillListItem } from '../../api/types'
import { skillDisplayName } from '../../utils/skill-name'
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
    label: skillDisplayName(skill),
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
