<script setup lang="ts">
/**
 * 本体选择器（`FR-058`，2026-10-17）。
 *
 * 数字人**按引用**使用本体：值形如 `{场景名}/{本体名}`（两段），正文不进设计态文档——
 * 部署物化时才从平台本体库把 `ontology.yaml` + `securities.yaml` 复制进运行环境，
 * 因此"库里更新了本体 → 下次部署同步生效"，与 SKILL 同一口径。
 *
 * 为什么显示 `{场景名}-{本体名}`：同名本体可存在于不同场景，只显示本体名会让
 * 两个候选看起来一模一样（取名口径见 `utils/ontology-name.ts`）。
 */
import { computed } from 'vue'
import type { OntologyCandidate } from '../../api/ontologies'
import {
  ontologyDisplayName,
  ontologyNameOf,
  ontologyScenarioOf,
} from '../../utils/ontology-name'
import CheckboxList from '../common/CheckboxList.vue'
import type { CheckboxOption } from '../common/checkbox-option'

const props = defineProps<{
  ontologies: OntologyCandidate[]
  modelValue: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

/**
 * 引用值 = `{场景名}/{本体名}`（部署时按它定位库内目录）。
 *
 * 两个名字都来自 `metadata`（候选本身就是 `{ metadata }`，服务端不再下发副本字段）。
 */
function refOf(candidate: OntologyCandidate): string {
  return `${ontologyScenarioOf(candidate)}/${ontologyNameOf(candidate)}`
}

/** 副标题只放能区分条目的信息：部署版本 + 创建时间（缺项不显示） */
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

/**
 * 失效引用：库里已删（或本机查看的是另一份库）但仍留在设计态里的本体。
 * 与 SKILL 一致——单独呈现并允许移除，保存时服务端也会拒绝。
 */
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
