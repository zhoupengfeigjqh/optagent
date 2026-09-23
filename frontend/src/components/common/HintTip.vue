<script setup lang="ts">
/**
 * 「?」气泡提示：解释性文案的统一呈现方式。
 *
 * 为什么是"按需展开"而不是常驻：这类文案（上传区的表头要求、HITL 弹窗的参数说明与操作说明）
 * 只占用户极少数注意力，常驻会把界面挤满、把真正要填的控件压下去。
 *
 * 为什么做成组件：同一职责 MUST 只有一处实现——上传区、字段行、弹窗头部、规则选择器
 * 都复用本组件，不各写一套浮层。样式与交互沿用上传区既有的「?」按钮形态。
 *
 * 交互：点击「?」展开/收起；展开期间挂 `document` 点击监听，点浮层外收起。
 * 无障碍：按钮 `aria-expanded` + `aria-label`，浮层 `role="tooltip"`（键盘可用、读屏可读）。
 */
import { onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 浮层文案（多行用 `\n` 分隔，渲染时保留换行） */
    text: string
    /** 按钮的无障碍名（不同场景措辞不同，如「查看表头要求」「查看参数说明」） */
    label?: string
  }>(),
  { label: '查看说明' },
)

const open = ref(false)

/** 展开/收起；阻止冒泡，避免触发外层的关闭逻辑（如菜单、弹窗遮罩）。 */
function toggle(event: MouseEvent): void {
  event.stopPropagation()
  open.value = !open.value
}

function onDocumentClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (!target?.closest('.hint-tip')) open.value = false
}

// 仅在展开期间挂监听（`flush: 'pre'` 保证本次点击不会误触发关闭）
watch(open, (value) => {
  if (value) document.addEventListener('click', onDocumentClick)
  else document.removeEventListener('click', onDocumentClick)
})

onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <span class="hint-tip">
    <button
      type="button"
      class="hint-tip__btn"
      :aria-label="label"
      :aria-expanded="open"
      @click="toggle"
    >
      ?
    </button>
    <span v-if="open" class="hint-tip__pop" role="tooltip">{{ props.text }}</span>
  </span>
</template>

<style scoped>
.hint-tip {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: none;
}

.hint-tip__btn {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
}

.hint-tip__btn:hover,
.hint-tip__btn[aria-expanded='true'] {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

.hint-tip__pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 10;
  width: max-content;
  max-width: min(320px, 90vw);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  box-shadow: var(--shadow-md, 0 4px 12px rgb(0 0 0 / 12%));
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: 400;
  line-height: 1.4;
  text-align: left;
  white-space: pre-line;
  word-break: break-word;
}
</style>
