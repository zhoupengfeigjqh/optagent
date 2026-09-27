<script setup lang="ts">
/**
 * MCP 服务卡片列表（`FR-043`、`FR-006`；2026-09-27 改版）。
 *
 * 卡片含**名称、用途描述、传输方式与连接地址**——MCP 服务由管理员在平台内
 * 人工登记，故不再有容器运行态（"运行中/已停止/异常"）。「新建 MCP 服务」按钮
 * 与「数字人设计」区的「新建数字人」同风格：卡片区上方右对齐的工具栏。
 */
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

/** 传输方式展示名：内部值 `http` 对应 MCP 的 Streamable HTTP */
function transportLabel(transport: string): string {
  // 内部规范值是 `http`；若数据里直接就是生态叫法（`streamable-http`）也照原样显示
  return transport === 'http' ? 'streamable-http' : transport
}
</script>

<template>
  <div class="mcp-card-list">
    <div class="mcp-card-list__toolbar">
      <button type="button" class="btn btn--primary" @click="emit('create')">
        新建 MCP 服务
      </button>
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
        <article
          class="card"
          :aria-label="`MCP 服务 ${(item as McpServiceListItem).name}`"
        >
          <p class="card__head">
            <span class="card__title">{{ (item as McpServiceListItem).name }}</span>
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
</style>
