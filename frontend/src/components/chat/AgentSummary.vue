<script setup lang="ts">
/**
 * 数字人概要（T065，FR-032 / FR-033）
 *
 * - 未选定数字人 → 提示"请选择数字人"，且 **不渲染 MCP 列表容器**（避免空容器）
 * - 列表以服务名作为稳定 `key`：轮询刷新状态时仅更新对应项，不重挂载其余项（SC-010）
 */
import type { McpServiceStatus } from '../../api/types'
import McpStatusItem from './McpStatusItem.vue'

withDefaults(
  defineProps<{
    /** 当前数字人名称；`null` 表示未选定 */
    agentName?: string | null
    /** 当前数字人的 MCP 服务状态 */
    mcpServers?: McpServiceStatus[]
  }>(),
  { agentName: null, mcpServers: () => [] },
)
</script>

<template>
  <div class="agent-summary">
    <p v-if="agentName === null" class="agent-summary__hint">请选择数字人</p>
    <p v-else class="agent-summary__name">{{ agentName }}</p>

    <ul
      v-if="agentName !== null && mcpServers.length > 0"
      class="agent-summary__mcp"
      aria-label="MCP 服务状态"
    >
      <li v-for="server in mcpServers" :key="server.name" class="agent-summary__mcp-item">
        <McpStatusItem :name="server.name" :transport="server.transport" :status="server.status" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.agent-summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.agent-summary__name {
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.agent-summary__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.agent-summary__mcp {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
</style>
