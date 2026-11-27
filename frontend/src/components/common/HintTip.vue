<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    text: string
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
