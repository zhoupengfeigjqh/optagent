<script setup lang="ts">
/**
 * 数字人概要（T065，FR-032 / FR-033）
 *
 * 职责只有"身份"：数字人名称，或未选定时的"请选择数字人"提示。
 *
 * 2026-10-29（014）：MCP 状态列表已拆出为 `McpStatusList.vue` —— 它必须与「切换」按钮
 * 左边缘对齐，而嵌在名称下方时起点会被按钮宽度推右，因此不能再挂在本组件内。
 */
withDefaults(
  defineProps<{
    /** 当前数字人名称；`null` 表示未选定 */
    agentName?: string | null
  }>(),
  { agentName: null },
)
</script>

<template>
  <div class="agent-summary">
    <p v-if="agentName === null" class="agent-summary__hint">请选择数字人</p>
    <p v-else class="agent-summary__name">{{ agentName }}</p>
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
</style>
