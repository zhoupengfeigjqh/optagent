<script setup lang="ts">
import type { McpServiceStatus } from '../../api/types'
import McpStatusItem from './McpStatusItem.vue'

withDefaults(
  defineProps<{
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
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
