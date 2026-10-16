<script setup lang="ts">
/**
 * 建议卡片（007）：下一步动作与首屏「问题实例」共用的一枚卡片。
 *
 * 与 `.chat-panel__starter` **同源**（同一套 CSS 变量与形态，FR-012）：两处必须是
 * 同一张卡的外观，否则就是"引入了第二套视觉体系"。
 *
 * 三点刻意：
 * - **原生 `<button>`**：键盘 `Tab` / `Enter` / `Space` 天然可达（无障碍原则四），
 *   不需要另加 `tabindex` 或键盘处理；
 * - **只渲染文本**：关联工具（`tools`）是内部细节，MUST NOT 出现在 DOM 里（FR-013），
 *   故本组件根本不接收它——调用方也无从误传；
 * - **`data-test` 由使用方传入**：靠属性透传落到根节点，组件不必声明。
 */
withDefaults(
  defineProps<{
    /** 卡片文本（= 提示词全文） */
    text: string
    /** 本轮进行中 / 未选数字人等场景下置灰（不可点击） */
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{
  /** 用户点选该卡片（确认与发送由上层决定） */
  select: []
}>()
</script>

<template>
  <button type="button" class="suggestion-card" :disabled="disabled" @click="emit('select')">
    <span class="suggestion-card__text">{{ text }}</span>
  </button>
</template>

<style scoped>
.suggestion-card {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border, #dfe3ea);
  border-radius: var(--radius-md);
  background: var(--color-surface, #fff);
  color: inherit;
  font: inherit;
  font-size: var(--font-size-sm, 13px);
  text-align: left;
  cursor: pointer;
}

.suggestion-card__text {
  line-height: var(--line-height-tight);
}

.suggestion-card:hover:not(:disabled) {
  border-color: var(--color-primary, #2f6fed);
}

.suggestion-card:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
