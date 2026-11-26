<script setup lang="ts">
import { computed } from 'vue'

import type { Conversation } from '../../api/types'
import BaseButton from '../common/BaseButton.vue'
import EmptyState from '../common/EmptyState.vue'
import LoadingDots from '../common/LoadingDots.vue'
import HistoryItem from './HistoryItem.vue'

const props = withDefaults(
  defineProps<{
    threads?: Conversation[]
    activeId?: string | null
    limit?: 10 | 100
    loading?: boolean
    /** 有进行中会话时禁止切换（列表项禁用） */
    busy?: boolean
  }>(),
  { threads: () => [], activeId: null, limit: 10, loading: false, busy: false },
)

const emit = defineEmits<{
  select: [threadId: string]
  more: []
  create: []
  /** 提交新标题（请求与回滚由 `views/WorkbenchView.vue` 交给 `useThreads.rename`） */
  rename: [payload: { threadId: string; title: string }]
  export: [threadId: string]
  remove: [threadId: string]
}>()

const shown = computed(() => props.threads.slice(0, props.limit))
const hasMore = computed(() => props.threads.length > props.limit)
</script>

<template>
  <nav class="history-sidebar" aria-label="历史会话">
    <div class="history-sidebar__header">
      <BaseButton variant="primary" size="sm" @click="emit('create')">新建会话</BaseButton>
    </div>

    <LoadingDots v-if="loading" label="正在加载会话" />

    <EmptyState
      v-else-if="threads.length === 0"
      title="还没有会话"
      description="点击上方「新建会话」开始"
    />

    <ul v-else class="history-sidebar__list">
      <HistoryItem
        v-for="thread in shown"
        :key="thread.thread_id"
        :thread="thread"
        :active="thread.thread_id === activeId"
        :disabled="busy"
        :running="busy && thread.thread_id === activeId"
        @select="emit('select', $event)"
        @rename="emit('rename', $event)"
        @export="emit('export', $event)"
        @remove="emit('remove', $event)"
      />
    </ul>

    <button v-if="hasMore" type="button" class="history-sidebar__more" @click="emit('more')">
      查看更多（最多 100 条）
    </button>
  </nav>
</template>

<style scoped>
.history-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  height: 100%;
  min-height: 0;
  padding: var(--space-3);
  overflow-y: auto;
}

.history-sidebar__header {
  flex: none;
}

.history-sidebar__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.history-sidebar__more {
  flex: none;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-xs);
  cursor: pointer;
}

.history-sidebar__more:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}
</style>
