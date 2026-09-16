<script setup lang="ts">
/**
 * 数字人卡片列表（`FR-014`、`FR-006`）。
 *
 * 卡片含**名称与用途描述**；异常实体以可辨识异常态呈现（图标 + 文本，不只靠颜色）
 * 且**不影响其余卡片**（`FR-006`）。
 */
import type { AgentListItem, ErrorInfo } from '../../api/types'
import EntityCardList from '../common/EntityCardList.vue'
import StatusBadge from '../common/StatusBadge.vue'

defineProps<{
  items: AgentListItem[]
  total: number
  page: number
  loading: boolean
  error: ErrorInfo | null
}>()

const emit = defineEmits<{
  (e: 'update:page', value: number): void
  (e: 'open', name: string): void
  (e: 'create'): void
}>()
</script>

<template>
  <div class="agent-card-list">
    <div class="agent-card-list__toolbar">
      <button type="button" class="btn btn--primary" @click="emit('create')">
        新建数字人
      </button>
    </div>

    <EntityCardList
      title="数字人设计"
      :items="items"
      :total="total"
      :page="page"
      :loading="loading"
      :error="error"
      :item-key="(item) => (item as AgentListItem).name"
      empty-title="还没有数字人"
      empty-description="点击「新建数字人」开始设计第一个数字人。"
      @update:page="emit('update:page', $event)"
    >
      <template #item="{ item }">
        <article
          class="card"
          :class="{ 'card--abnormal': (item as AgentListItem).abnormal }"
          :aria-label="`数字人 ${(item as AgentListItem).name}`"
        >
          <p class="card__head">
            <span class="card__title">{{ (item as AgentListItem).name }}</span>
            <StatusBadge
              v-if="(item as AgentListItem).abnormal"
              status="abnormal"
              label="异常"
              tone="error"
            />
          </p>
          <p class="card__description">{{ (item as AgentListItem).description || '（无描述）' }}</p>
          <p v-if="(item as AgentListItem).abnormal_reason" class="card__abnormal-reason">
            <span aria-hidden="true">⚠</span>
            {{ (item as AgentListItem).abnormal_reason }}
          </p>
          <p class="card__meta">更新于 {{ (item as AgentListItem).updated_at }}</p>
          <div class="card__actions">
            <button
              type="button"
              class="btn"
              :aria-label="`打开数字人 ${(item as AgentListItem).name} 的设计`"
              @click="emit('open', (item as AgentListItem).name)"
            >
              打开设计
            </button>
          </div>
        </article>
      </template>
    </EntityCardList>
  </div>
</template>

<style scoped>
.agent-card-list__toolbar {
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

.card__abnormal-reason {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-status-error);
  overflow-wrap: anywhere;
}
</style>
