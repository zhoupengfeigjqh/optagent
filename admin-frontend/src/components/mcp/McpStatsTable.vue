<script setup lang="ts">
import { computed } from 'vue'
import type { McpStatsGroup } from '../../api/types'

const props = defineProps<{
  groups: McpStatsGroup[]
  available: boolean
  only?: string
}>()

/** 时间窗列：表头与单元格共用同一份定义，避免两处各写一遍导致错位 */
const WINDOWS = [
  { key: 'h24', label: '最近24h' },
  { key: 'd7', label: '最近7天' },
  { key: 'd30', label: '最近30天' },
  { key: 'd365', label: '最近一年' },
] as const

const rows = computed(() =>
  props.only ? props.groups.filter((group) => group.service === props.only) : props.groups,
)

/**
 * 空态文案：三种"没有行"的原因各不相同，不能混成一句。
 * 原先分两条 `<tr>` 判断，`only` 且无行时两者会**同时**渲染（重复提示），此处收敛成一个。
 */
const emptyText = computed(() => {
  if (!props.available) return '未知'
  return props.only ? '该服务从未被调用过（统计为 0）。' : '尚无任何调用记录'
})

function text(value: string | number | null | undefined): string {
  if (!props.available) return '未知'
  if (value === null || value === undefined) return '—'
  return String(value)
}

/** 时间窗单元格：「总次数/成功次数」；缺该窗（旧响应）显示"—"，不可用时不以 0 冒充 */
function windowCell(group: McpStatsGroup, key: 'h24' | 'd7' | 'd30' | 'd365'): string {
  if (!props.available) return '未知'
  const window = group.windows?.[key]
  if (!window) return '—'
  return `${window.total}/${window.ok}`
}

function userLabel(group: McpStatsGroup): string {
  return group.user_id ?? '（未归属·升级前记录）'
}

function toolLabel(group: McpStatsGroup): string {
  return group.tool_name ?? '（未归属·升级前记录）'
}

/** 行键：三个维度都可能是 `null`，故用数组序列化，避免拼接时相邻字段串位 */
function rowKey(group: McpStatsGroup): string {
  return JSON.stringify([group.service, group.tool_name, group.user_id])
}
</script>

<template>
  <section class="mcp-stats" aria-label="MCP 调用统计">
    <p v-if="!props.available" class="mcp-stats__unknown" role="status">
      运行环境不可达，调用统计**未知**（MUST NOT 以 0 冒充）。
    </p>

    <table class="mcp-stats__table">
      <caption class="visually-hidden">
        按「用户 × 服务 × 工具」的 MCP 工具调用次数（含四个时间窗）
      </caption>
      <thead>
        <tr>
          <th scope="col">用户名</th>
          <th scope="col">服务名</th>
          <th scope="col">工具名</th>
          <th v-for="window in WINDOWS" :key="window.key" scope="col">{{ window.label }}</th>
          <th scope="col">最近调用时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="rows.length === 0">
          <td colspan="8" class="muted">{{ emptyText }}</td>
        </tr>
        <tr v-for="group in rows" :key="rowKey(group)">
          <td class="mono">{{ userLabel(group) }}</td>
          <td class="mono">{{ group.service }}</td>
          <td class="mono">{{ toolLabel(group) }}</td>
          <td v-for="window in WINDOWS" :key="window.key">{{ windowCell(group, window.key) }}</td>
          <td>{{ text(group.last_called_at ?? '从未调用') }}</td>
        </tr>
      </tbody>
    </table>
    <p class="mcp-stats__note">
      单元格格式：<code class="mono">总次数/成功次数</code>；一行 = 一个「用户 × 服务 × 工具」组合，
      事件明细保留一年，故四个时间窗与"最近一年"同源。
    </p>
  </section>
</template>

<style scoped>
.mcp-stats__unknown {
  margin: 0 0 var(--space-2);
  color: var(--color-status-warning);
  font-size: var(--font-size-sm);
}

.mcp-stats__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.mcp-stats__table th,
.mcp-stats__table td {
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  text-align: left;
}

.mcp-stats__note {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
</style>
