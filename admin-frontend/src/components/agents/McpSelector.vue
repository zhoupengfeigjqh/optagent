<script setup lang="ts">
/**
 * MCP 服务选择器（`FR-018`、`FR-019`）。
 *
 * 数字人**按名称引用** MCP 服务，MUST NOT 内嵌连接信息——连接地址由平台侧的
 * 调用配置提供（`FR-044`），因此这里只呈现名称、用途与连接地址；
 * 改调用配置会自动作用于所有引用它的数字人。
 *
 * 可选范围 = **平台内新建的 MCP 服务**（2026-09-27 起不再取自容器编排声明）。
 */
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
