<script setup lang="ts">
/**
 * 聊天区头部（T067）
 *
 * 左侧纵向两段（2026-10-29，014）：
 * 1. 身份行：「切换」按钮 + 数字人名称（未选定 → "请选择数字人"提示）；
 * 2. 状态行：MCP 服务连接状态，作为身份容器的直接子项 ⇒ 左边缘与「切换」按钮对齐（FR-001）。
 *
 * 之所以拆两行而不是让状态留在名称下方：状态嵌在名称列里时起点被按钮宽度推右，
 * 再怎么调间距都对不齐；拆行后左边缘＝容器起点＝按钮左边缘，且信息顺序不变（FR-002）。
 *
 * 右侧：搜索 / 工作空间两个按钮位（工作空间抽屉由 US8 接入，此处先维护开关状态）。
 */
import { computed } from 'vue'

import type { DigitalHuman, McpServiceStatus } from '../../api/types'
import BaseIcon from '../common/BaseIcon.vue'
import AgentSummary from './AgentSummary.vue'
import McpStatusList from './McpStatusList.vue'

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
    <!-- 最左：两行结构。第一行是「切换 + 名称」，第二行是 MCP 状态；
         状态行是身份容器的直接子项，因此左边缘与切换按钮严格对齐（014 FR-001） -->
    <div class="chat-header__identity">
      <div class="chat-header__identity-row">
        <button
          type="button"
          class="chat-header__switch"
          aria-label="切换数字人"
          :aria-pressed="agentPanelOpen ? 'true' : 'false'"
          @click="emit('toggle-agent')"
        >
          <BaseIcon name="agent" :size="16" />
          <span class="chat-header__switch-label">切换</span>
        </button>

        <AgentSummary :agent-name="agentName" />
      </div>

      <!-- 未选定数字人时 servers 为空，列表自身不渲染（FR-004，无空容器） -->
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

      <!-- 自带数据与面板的动作位（后台产出铃铛）由调用方注入：
           本组件保持纯展示，不引入任何业务依赖（与上面两个按钮同一取向） -->
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

/* 身份容器：纵向两段，`stretch` 让状态行与身份行同宽、同起点 ⇒ 左对齐 */
.chat-header__identity {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-1);
  min-width: 0;
}

.chat-header__identity-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
}

/* 切换按钮：图标 + 文案，描边以区别于右侧纯图标动作位（同列紧邻数字人名称） */
.chat-header__switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  cursor: pointer;
}

.chat-header__switch:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.chat-header__switch[aria-pressed='true'] {
  border-color: var(--color-primary);
  background: var(--color-primary-subtle);
  color: var(--color-primary);
}

.chat-header__switch-label {
  white-space: nowrap;
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
