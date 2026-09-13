<script setup lang="ts">
/**
 * MCP 服务状态项（T064，FR-033 / FR-038）
 *
 * **双通道标识**：颜色 + 文本（"连接正常"/"连接失败"/"未连接"），不依赖颜色单独传达状态。
 * `failed` 只是观测结果——不弹窗、不阻断主流程（FR-034 / FR-038）。
 * `unknown` 表示尚无连接结果（实例未创建或首次建连进行中），中性灰呈现，不误报为故障。
 * 状态变化只改类名与文本，元素本身不重挂载。
 */
import { computed } from 'vue'

import type { McpConnectionStatus } from '../../api/types'

const props = defineProps<{
  /** 服务名 */
  name: string
  /** 传输方式 */
  transport: string
  /** 连接状态 */
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
    <span class="mcp-status-item__transport">{{ transport }}</span>
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

/* 默认（含 unknown）：中性灰，表示尚无连接结果 */
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
