<script setup lang="ts">
import { computed } from 'vue'
import type { OntologyCandidate } from '../../api/ontologies'
import { ontologyDisplayName, ontologyNameOf, ontologyScenarioOf } from '../../utils/ontology-name'
import CheckboxList from '../common/CheckboxList.vue'
import type { CheckboxOption } from '../common/checkbox-option'

const props = defineProps<{
  ontologies: OntologyCandidate[]
  modelValue: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

function refOf(candidate: OntologyCandidate): string {
  return `${ontologyScenarioOf(candidate)}/${ontologyNameOf(candidate)}`
}

function descriptionOf(candidate: OntologyCandidate): string | undefined {
  const parts: string[] = []
  if (candidate.metadata.deployed_version) parts.push(`版本 ${candidate.metadata.deployed_version}`)
  if (candidate.metadata.created_at) parts.push(`创建于 ${candidate.metadata.created_at}`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

const options = computed<CheckboxOption[]>(() =>
  props.ontologies.map((candidate) => ({
    value: refOf(candidate),
    label: ontologyDisplayName(candidate),
    description: descriptionOf(candidate),
  })),
)

const known = computed(() => new Set(props.ontologies.map((candidate) => refOf(candidate))))

const orphans = computed(() => props.modelValue.filter((ref) => !known.value.has(ref)))
</script>

<template>
  <CheckboxList
    legend="引用的本体（平台本体库）"
    :options="options"
    :model-value="modelValue"
    :orphans="orphans"
    search-placeholder="按场景名或本体名搜索…"
    empty-text="本体库为空（可在「本体管理」功能区内从本体市场导入）"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
