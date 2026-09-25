<script setup lang="ts">
/**
 * 聊天区头部（T067）
 *
 * 左侧：数字人概要（名称 + MCP 状态，未选定 → 提示且 MCP 区域为空）；
 * 右侧：搜索 / 工作空间 / 数字人三个按钮位（工作空间抽屉由 US8 接入，此处先维护开关状态）。
 */
import { computed } from 'vue'

import type { DigitalHuman, McpServiceStatus } from '../../api/types'
import BaseIcon from '../common/BaseIcon.vue'
import AgentSummary from './AgentSummary.vue'

const props = withDefaults(
  defineProps<{
    /** 当前数字人；`null` 表示未选定 */
    agent?: DigitalHuman | null
    /** 当前数字人的 MCP 服务状态 */
    mcpServers?: McpServiceStatus[]
    /** 搜索栏是否展开 */
    searchOpen?: boolean
    /** 工作空间抽屉是否展开 */
    workspaceOpen?: boolean
    /** 数字人面板是否展开 */
    agentPanelOpen?: boolean
  }>(),
  {
    agent: null,
    mcpServers: () => [],
    searchOpen: false,
    workspaceOpen: false,
    agentPanelOpen: false,
  },
)

const emit = defineEmits<{
  'toggle-search': []
  'toggle-workspace': []
  'toggle-agent': []
}>()

const agentName = computed(() => props.agent?.agent_name ?? null)
/** 未选定数字人时 MCP 区域为空（FR-032） */
const visibleMcpServers = computed<McpServiceStatus[]>(() =>
  props.agent === null ? [] : props.mcpServers,
)
</script>

<template>
  <header class="chat-header">
    <AgentSummary :agent-name="agentName" :mcp-servers="visibleMcpServers" />

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

      <button
        type="button"
        class="chat-header__action"
        aria-label="数字人"
        :aria-pressed="agentPanelOpen ? 'true' : 'false'"
        @click="emit('toggle-agent')"
      >
        <BaseIcon name="agent" :size="16" />
      </button>

      <!-- 自带数据与面板的动作位（后台产出铃铛）由调用方注入：
           本组件保持纯展示，不引入任何业务依赖（与上面三个按钮同一取向） -->
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
