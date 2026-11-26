<script setup lang="ts">
import { computed } from 'vue'
import type { McpServiceListItem } from '../../api/types'
import CheckboxList from '../common/CheckboxList.vue'
import type { CheckboxOption } from '../common/checkbox-option'

const props = defineProps<{
  services: McpServiceListItem[]
  modelValue: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

function transportLabel(transport: string): string {
  return transport === 'http' ? 'streamable-http' : transport
}

const options = computed<CheckboxOption[]>(() =>
  props.services.map((service) => ({
    value: service.name,
    label: service.name,
    description: `${service.description || '（未填写用途描述）'} · ${service.url ?? 'stdio（本地命令）'}`,
    badge: transportLabel(service.transport),
  })),
)

const known = computed(() => new Set(props.services.map((s) => s.name)))
const orphans = computed(() => props.modelValue.filter((name) => !known.value.has(name)))
</script>

<template>
  <CheckboxList
    legend="引用的 MCP 服务（按名称引用）"
    :options="options"
    :model-value="modelValue"
    :orphans="orphans"
    search-placeholder="按服务名或用途搜索…"
    empty-text="还没有 MCP 服务（请先在「MCP 服务」区新建）"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
