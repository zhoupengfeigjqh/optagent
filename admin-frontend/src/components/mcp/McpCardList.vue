<script setup lang="ts">
import type { ErrorInfo, McpServiceListItem, McpStatsItem } from '../../api/types'
import EntityCardList from '../common/EntityCardList.vue'

const props = defineProps<{
  items: McpServiceListItem[]
  total: number
  page: number
  loading: boolean
  error: ErrorInfo | null
  stats: McpStatsItem[]
  statsAvailable: boolean
}>()

const emit = defineEmits<{
  (e: 'update:page', value: number): void
  (e: 'open', name: string): void
  (e: 'create'): void
}>()

/** 统计显示：不可达时显示"未知"而非 0（`FR-009`） */
function callsOf(name: string): string {
  if (!props.statsAvailable) return '未知'
  const item = props.stats.find((s) => s.name === name)
  return item ? String(item.calls_total) : '0'
}

function transportLabel(transport: string): string {
  return transport === 'http' ? 'streamable-http' : transport
}
</script>

<template>
  <div class="mcp-card-list">
    <div class="mcp-card-list__toolbar">
      <button type="button" class="btn btn--primary" @click="emit('create')">新建 MCP 服务</button>
    </div>

    <EntityCardList
      title="MCP 服务"
      :items="items"
      :total="total"
      :page="page"
      :loading="loading"
      :error="error"
      :item-key="(item) => (item as McpServiceListItem).name"
      empty-title="还没有 MCP 服务"
      empty-description="点击「新建 MCP 服务」登记第一个服务（名称 + 连接地址）。"
      @update:page="emit('update:page', $event)"
    >
      <template #item="{ item }">
        <article class="card" :aria-label="`MCP 服务 ${(item as McpServiceListItem).name}`">
          <p class="card__head">
            <span class="card__title">
              {{ (item as McpServiceListItem).name }}
              <span
                v-if="(item as McpServiceListItem).has_headers"
                class="card__badge"
                data-test="headers-badge"
                title="已配置请求头（通常为访问令牌）；值以掩码显示，不回显明文"
              >
                需请求头
              </span>
            </span>
          </p>
          <p class="card__description">
            {{ (item as McpServiceListItem).description || '（未填写用途描述）' }}
          </p>
          <p class="card__meta">
            传输 {{ transportLabel((item as McpServiceListItem).transport) }} · 最近一年调用
            {{ callsOf((item as McpServiceListItem).name) }}
          </p>
          <p class="card__url mono">
            {{ (item as McpServiceListItem).url || '（stdio：本地命令启动）' }}
          </p>
          <div class="card__actions">
            <button
              type="button"
              class="btn"
              :aria-label="`查看服务 ${(item as McpServiceListItem).name} 详情`"
              @click="emit('open', (item as McpServiceListItem).name)"
            >
              查看详情
            </button>
          </div>
        </article>
      </template>
    </EntityCardList>
  </div>
</template>

<style scoped>
.mcp-card-list__toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--space-4);
}

.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin: 0;
}

.card__url {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.card__badge {
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-bg-muted);
  color: var(--color-status-warning);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  vertical-align: middle;
  white-space: nowrap;
}
</style>
