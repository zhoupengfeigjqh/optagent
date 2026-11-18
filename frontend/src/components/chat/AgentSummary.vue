<script setup lang="ts">
/**
 * 数字人概要（T065，FR-032 / FR-033）
 *
 * 职责只有"身份"：数字人名称，或未选定时的"请选择数字人"提示。
 *
 * 2026-10-29（014）：MCP 状态列表已拆出为 `McpStatusList.vue` —— 它必须与账号菜单
 * 左边缘对齐，而嵌在名称下方时起点会被菜单宽度推右，因此不能再挂在本组件内。
 *
 * 2026-11-18：字号提到 `--font-size-md`（与账号菜单触发器同一字号）。此前用 `sm`(13px)，
 * 与 14px 的菜单文字并排时"名称小一号、又与按钮顶边齐平"，视觉上很别扭；行内居中对齐
 * 由 `ChatHeader` 的 `.chat-header__identity-row` 负责。
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

/* 与账号菜单触发器同一字号（14px）：并排时不出现"名称小一号"的割裂感 */
.agent-summary__name {
  font-size: var(--font-size-md);
  font-weight: 600;
  line-height: var(--line-height-base);
}

.agent-summary__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-md);
  line-height: var(--line-height-base);
}
</style>
