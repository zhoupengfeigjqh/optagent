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
 *
 * 2026-11-18：登录后仍未选择数字人时，「请选择数字人」改用失败态红色（`--color-status-error`）。
 * 语义是"待处理的状态缺失"而不是普通说明文字；文案本身已表达含义，颜色只是强化，
 * 不依赖颜色单通道传达信息。
 */
const props = withDefaults(
  defineProps<{
    /** 当前数字人名称；`null` 表示未选定 */
    agentName?: string | null
    /** 未选定时是否允许打开选择面板 */
    selectEnabled?: boolean
    /** 未选定状态的主文案 */
    emptyLabel?: string
  }>(),
  { agentName: null, selectEnabled: true, emptyLabel: '请选择数字人' },
)

const emit = defineEmits<{
  (e: 'select'): void
}>()
</script>

<template>
  <div class="agent-summary">
    <button
      v-if="agentName === null"
      type="button"
      class="agent-summary__hint"
      :disabled="!props.selectEnabled"
      @click="emit('select')"
    >
      {{ props.emptyLabel }}
    </button>
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

/* 未选择数字人＝待处理的状态缺失，用失败态红色提示，而不是弱化的说明文字灰 */
.agent-summary__hint {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-status-error);
  font-size: var(--font-size-md);
  line-height: var(--line-height-base);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.agent-summary__hint:hover:not(:disabled) {
  text-decoration: underline;
}

.agent-summary__hint:disabled {
  color: var(--color-text-muted);
  cursor: not-allowed;
}
</style>
