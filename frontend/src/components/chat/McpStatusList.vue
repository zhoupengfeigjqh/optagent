<script setup lang="ts">
/**
 * MCP 服务连接状态列表（2026-10-29，014）。
 *
 * 从 `AgentSummary` 拆出：头部左侧改为两行——第一行「切换」按钮 + 数字人名称，
 * 第二行 MCP 状态。状态行作为身份容器的直接子项，左边缘才与「切换」按钮对齐（FR-001）。
 *
 * 空列表时**不渲染容器**（FR-004）：未选定数字人或数字人未配置 MCP 时不留空 `<ul>`。
 * 列表以服务名作为稳定 `key`：轮询刷新状态时仅更新对应项，不重挂载其余项。
 */
import type { McpServiceStatus } from '../../api/types'
import McpStatusItem from './McpStatusItem.vue'

withDefaults(
  defineProps<{
    /** 当前数字人的 MCP 服务状态 */
    servers?: McpServiceStatus[]
  }>(),
  { servers: () => [] },
)
</script>

<template>
  <ul v-if="servers.length > 0" class="mcp-status-list" aria-label="MCP 服务状态">
    <li v-for="server in servers" :key="server.name" class="mcp-status-list__item">
      <McpStatusItem :name="server.name" :status="server.status" />
    </li>
  </ul>
</template>

<style scoped>
.mcp-status-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  /* 左边缘 MUST 与身份行起点（切换按钮左边缘）一致：不引入任何额外缩进 */
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
