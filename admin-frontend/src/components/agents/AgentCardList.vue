<script setup lang="ts">
/**
 * 数字人卡片列表。
 *
 * 卡片同时展示对应注册服务编码与已注册人数；「生成注册链接」只发出意图，
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
  (e: 'register-link', agent: AgentListItem): void
  (e: 'create'): void
}>()

const servicesByAgent = computed(
  () => new Map(props.services.map((service) => [service.platform_agent_name, service])),
)
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
            <StatusBadge
              v-if="(item as AgentListItem).abnormal"
              status="abnormal"
              label="异常"
              tone="error"
            />
          </p>
          <p class="card__description">{{ (item as AgentListItem).description || '（无描述）' }}</p>
          <div class="agent-card-list__tags">
            <span class="agent-card-list__tag">
              {{
                servicesByAgent.get((item as AgentListItem).name)
                  ? `编码 ${servicesByAgent.get((item as AgentListItem).name)?.code}`
                  : '未配置注册服务'
              }}
            </span>
            <span
              v-if="servicesByAgent.get((item as AgentListItem).name)"
              class="agent-card-list__tag agent-card-list__tag--success"
            >
              注册用户 {{ servicesByAgent.get((item as AgentListItem).name)?.registered_users }} 人
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
              :aria-label="`为数字人 ${(item as AgentListItem).name} 生成注册链接`"
              @click="emit('register-link', item as AgentListItem)"
            >
              生成注册链接
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
