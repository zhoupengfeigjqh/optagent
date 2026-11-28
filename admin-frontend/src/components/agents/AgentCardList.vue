<script setup lang="ts">
/**
 * 数字人卡片列表。
 *
 * 卡片展示编码（以设计态自带的 `code` 为准，与注册服务同源；旧设计回退到服务清单）
 * 与已注册人数；「注册管理」只发出意图（打开管理弹窗，**不自动生成链接**），
 * 具体服务匹配和弹窗由 AgentArea 处理。
 */
import { computed } from 'vue'
import type { AgentListItem, AgentServiceItem, ErrorInfo } from '../../api/types'
import EntityCardList from '../common/EntityCardList.vue'
import StatusBadge from '../common/StatusBadge.vue'

const props = defineProps<{
  items: AgentListItem[]
  services: AgentServiceItem[]
  total: number
  page: number
  loading: boolean
  error: ErrorInfo | null
}>()

const emit = defineEmits<{
  (e: 'update:page', value: number): void
  (e: 'open', name: string): void
  (e: 'manage-registration', agent: AgentListItem): void
  (e: 'create'): void
}>()

const servicesByAgent = computed(
  () => new Map(props.services.map((service) => [service.platform_agent_name, service])),
)

/** 编码标签：设计态优先（与 `agent_services.code` 同源），旧设计回退到服务清单 */
function codeLabel(item: AgentListItem): string {
  const code = item.code ?? servicesByAgent.value.get(item.name)?.code ?? null
  return code ? `编码 ${code}` : '未配置注册服务'
}
</script>

<template>
  <div class="agent-card-list">
    <div class="agent-card-list__toolbar">
      <button type="button" class="btn btn--primary" @click="emit('create')">新建数字人</button>
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
            <!-- label / tone 交给 STATUS_PRESETS['abnormal']，避免第二份"异常"文案 -->
            <StatusBadge v-if="(item as AgentListItem).abnormal" status="abnormal" />
          </p>
          <p class="card__description">{{ (item as AgentListItem).description || '（无描述）' }}</p>
          <div class="agent-card-list__tags">
            <span class="agent-card-list__tag">
              {{ codeLabel(item as AgentListItem) }}
            </span>
            <span
              v-if="servicesByAgent.get((item as AgentListItem).name)"
              class="agent-card-list__tag agent-card-list__tag--success"
            >
              已授权用户 {{ servicesByAgent.get((item as AgentListItem).name)?.registered_users }} 人
            </span>
          </div>
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
            <button
              type="button"
              class="btn btn--link"
              :aria-label="`管理数字人 ${(item as AgentListItem).name} 的注册链接`"
              @click="emit('manage-registration', item as AgentListItem)"
            >
              注册管理
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

.agent-card-list__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.agent-card-list__tag {
  border-radius: var(--radius-sm);
  padding: 1px 7px;
  background: #f2f3f5;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.agent-card-list__tag--success {
  color: var(--color-status-success);
  background: var(--color-status-success-bg);
}
</style>
