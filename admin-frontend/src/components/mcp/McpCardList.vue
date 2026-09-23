<script setup lang="ts">
/**
 * MCP 服务卡片列表（`FR-043`、`FR-006`）。
 *
 * 卡片含**名称、用途描述、传输方式与状态四态**（运行中／已停止／异常／未知）；
 * 状态同时给图标与文本，不只靠颜色（原则四）。
 */
import type { ErrorInfo, McpServiceListItem, McpStatsItem } from '../../api/types'
import EntityCardList from '../common/EntityCardList.vue'
import StatusBadge from '../common/StatusBadge.vue'

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
}>()

/** 统计显示：不可达时显示"未知"而非 0（`FR-009`） */
function callsOf(name: string): string {
  if (!props.statsAvailable) return '未知'
  const item = props.stats.find((s) => s.name === name)
  return item ? String(item.calls_total) : '0'
}

/** 传输方式展示名：内部值 `http` 对应 MCP 的 Streamable HTTP */
function transportLabel(transport: string): string {
  // 内部规范值是 `http`；若数据里直接就是生态叫法（`streamable-http`）也照原样显示
  return transport === 'http' ? 'streamable-http' : transport
}
</script>

<template>
  <EntityCardList
    title="MCP 服务"
    :items="items"
    :total="total"
    :page="page"
    :loading="loading"
    :error="error"
    :item-key="(item) => (item as McpServiceListItem).name"
    empty-title="容器编排中没有 MCP 服务"
    empty-description="在 docker-compose.yml 中声明服务后，这里会自动出现（无需平台侧登记）。"
    @update:page="emit('update:page', $event)"
  >
    <template #item="{ item }">
      <article
        class="card"
        :class="{ 'card--abnormal': !(item as McpServiceListItem).in_compose }"
        :aria-label="`MCP 服务 ${(item as McpServiceListItem).name}`"
      >
        <p class="card__head">
          <span class="card__title">{{ (item as McpServiceListItem).name }}</span>
          <StatusBadge :status="(item as McpServiceListItem).status" />
        </p>
        <p class="card__description">
          {{ (item as McpServiceListItem).description || '（未填写用途描述）' }}
        </p>
        <p class="card__meta">
          传输 {{ transportLabel((item as McpServiceListItem).transport) }} · 最近一年调用 {{ callsOf((item as McpServiceListItem).name) }}
          · {{ (item as McpServiceListItem).configured ? '已配置' : '未配置' }}
        </p>
        <p v-if="(item as McpServiceListItem).abnormal_reason" class="card__abnormal-reason">
          <span aria-hidden="true">⚠</span>
          {{ (item as McpServiceListItem).abnormal_reason }}
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
</template>

<style scoped>
.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin: 0;
}

.card__abnormal-reason {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-status-error);
  overflow-wrap: anywhere;
}
</style>
