<script setup lang="ts">
/**
 * MCP 服务选择器（`FR-018`、`FR-019`）。
 *
 * 数字人**按名称引用** MCP 服务，MUST NOT 内嵌连接信息——连接地址由
 * 调用配置按目标运行形态提供（`FR-044`、`FR-056`），
 * 因此这里只呈现名称与用途；改调用配置会自动作用于所有引用它的数字人。
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

const STATUS_LABEL: Record<string, string> = {
  running: '运行中',
  stopped: '已停止',
  abnormal: '异常',
  unknown: '未知',
}

const options = computed<CheckboxOption[]>(() =>
  props.services.map((service) => ({
    value: service.name,
    label: service.name,
    description: service.description || '（未填写用途描述）',
    badge: STATUS_LABEL[service.status] ?? '未知',
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
    empty-text="容器编排声明中没有 MCP 服务"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
