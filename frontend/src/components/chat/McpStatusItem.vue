<script setup lang="ts">
import { computed } from 'vue'

import type { McpConnectionStatus } from '../../api/types'

const props = defineProps<{
  name: string
  status: McpConnectionStatus
}>()

const STATUS_LABEL: Readonly<Record<McpConnectionStatus, string>> = {
  connected: '连接正常',
  failed: '连接失败',
  unknown: '未连接',
}

/** 未知取值一律按 `unknown` 兜底：宁可显示"未连接"，也不误报为"连接失败" */
const statusLabel = computed(() => STATUS_LABEL[props.status] ?? STATUS_LABEL.unknown)
</script>

<template>
  <span class="mcp-status-item" :class="`mcp-status-item--${status}`">
    <span class="mcp-status-item__dot" aria-hidden="true" />
    <span class="mcp-status-item__name">{{ name }}</span>
    <span class="mcp-status-item__status">{{ statusLabel }}</span>
  </span>
</template>

<style scoped>
.mcp-status-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.mcp-status-item__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-status-pending);
}

.mcp-status-item--connected .mcp-status-item__dot {
  background: var(--color-status-success);
}

.mcp-status-item--failed .mcp-status-item__dot {
  background: var(--color-status-error);
}

.mcp-status-item--connected .mcp-status-item__status {
  color: var(--color-status-success);
}

.mcp-status-item--failed .mcp-status-item__status {
  color: var(--color-status-error);
}

.mcp-status-item--unknown .mcp-status-item__status {
  color: var(--color-status-pending);
}
</style>
