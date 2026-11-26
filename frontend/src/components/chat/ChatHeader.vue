<script setup lang="ts">
import { computed } from 'vue'

import type { DigitalHuman, McpServiceStatus } from '../../api/types'
import BaseIcon from '../common/BaseIcon.vue'
import AgentSummary from './AgentSummary.vue'
import McpStatusList from './McpStatusList.vue'
import UserMenu from './UserMenu.vue'

const props = withDefaults(
  defineProps<{
    agent?: DigitalHuman | null
    mcpServers?: McpServiceStatus[]
    searchOpen?: boolean
    workspaceOpen?: boolean
  }>(),
  {
    agent: null,
    mcpServers: () => [],
    searchOpen: false,
    workspaceOpen: false,
  },
)

const emit = defineEmits<{
  'toggle-search': []
  'toggle-workspace': []
  /** 账号菜单选择「切换数字人」：打开数字人面板（幂等打开，非开关） */
  'open-agent': []
}>()

const agentName = computed(() => props.agent?.agent_name ?? null)
const visibleMcpServers = computed<McpServiceStatus[]>(() =>
  props.agent === null ? [] : props.mcpServers,
)
</script>

<template>
  <header class="chat-header">
    <div class="chat-header__identity">
      <div class="chat-header__identity-row">
        <UserMenu @open-agent="emit('open-agent')" />

        <AgentSummary :agent-name="agentName" />
      </div>

      <McpStatusList :servers="visibleMcpServers" />
    </div>

    <div class="chat-header__actions">
      <button
        type="button"
        class="chat-header__action"
        aria-label="搜索对话"
        :aria-pressed="searchOpen ? 'true' : 'false'"
        @click="emit('toggle-search')"
      >
        <BaseIcon name="search" :size="16" />
      </button>

      <button
        type="button"
        class="chat-header__action"
        aria-label="工作空间"
        :aria-pressed="workspaceOpen ? 'true' : 'false'"
        @click="emit('toggle-workspace')"
      >
        <BaseIcon name="workspace" :size="16" />
      </button>

      <slot name="actions-extra" />
    </div>
  </header>
</template>

<style scoped>
.chat-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.chat-header__identity {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-1);
  min-width: 0;
}

.chat-header__identity-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.chat-header__actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
}

.chat-header__action {
  display: inline-flex;
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.chat-header__action:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.chat-header__action[aria-pressed='true'] {
  background: var(--color-primary-subtle);
  color: var(--color-primary);
}
</style>
