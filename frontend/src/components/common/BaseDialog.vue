<script setup lang="ts">
/**
 * 模态对话框（T026）
 *
 * 受控开合：由 `open` 驱动原生 `<dialog>`，所有关闭意图统一以 `close` 事件上报，
 * 由父级决定是否真正关闭（避免原生关闭与 prop 状态不同步）。
 * 原生 `<dialog>` 自带焦点陷阱与 Esc 关闭，无需自行实现。
 *
 * 宽度**两档**（2026-10-09 加宽版）：默认 `min(560px, 92vw)` 够用就不动；
 * 表格/结构化正文这类横向内容多的场景用 `wide`（`min(900px, 94vw)`），
 * 否则每列被挤成一条，只能靠横向滚动一列一列地看。
 * 两档都随视口收窄（窄屏 `92/94vw`），弹窗尺寸始终自适应。
 */
import { computed, onMounted, ref, useId, watch } from 'vue'

import BaseIcon from './BaseIcon.vue'

const props = withDefaults(
  defineProps<{
    /** 是否展开 */
    open?: boolean
    /** 标题文本 */
    title?: string
    /** 外部指定的无障碍标题元素 id（覆盖内部生成的 id） */
    labelledBy?: string | null
    /** 宽版：表格/结构化正文等横向内容多的场景 */
    wide?: boolean
  }>(),
  { open: false, title: '', labelledBy: null, wide: false },
)

const emit = defineEmits<{ close: [] }>()

const dialogRef = ref<HTMLDialogElement | null>(null)
const titleId = `base-dialog-title-${useId()}`
const labelId = computed(() => props.labelledBy ?? (props.title ? titleId : null))

/** 内部主动调用 `close()` 时置位，用于屏蔽随之而来的原生 `close` 事件。 */
let suppressCloseEvent = false

function syncOpen(value: boolean): void {
  const dialog = dialogRef.value
  if (!dialog) {
    return
  }
  if (value) {
    if (!dialog.open) {
      dialog.showModal?.()
    }
    return
  }
  if (dialog.open) {
    suppressCloseEvent = true
    dialog.close?.()
  }
}

onMounted(() => syncOpen(props.open))
watch(() => props.open, syncOpen)

function handleCancel(event: Event): void {
  // 阻止原生关闭，改由父级更新 `open` 后统一收敛
  event.preventDefault()
  emit('close')
}

function handleClose(): void {
  if (suppressCloseEvent) {
    suppressCloseEvent = false
    return
  }
  emit('close')
}

function handleBackdropClick(event: MouseEvent): void {
  if (event.target === dialogRef.value) {
    emit('close')
  }
}
</script>

<template>
  <dialog
    ref="dialogRef"
    class="base-dialog"
    :class="{ 'base-dialog--wide': wide }"
    :aria-labelledby="labelId ?? undefined"
    @cancel="handleCancel"
    @close="handleClose"
    @click="handleBackdropClick"
  >
    <div class="base-dialog__panel">
      <header class="base-dialog__header">
        <h2 v-if="title" :id="titleId" class="base-dialog__title">{{ title }}</h2>
        <button type="button" class="base-dialog__close" aria-label="关闭" @click="emit('close')">
          <BaseIcon name="close" :size="16" />
        </button>
      </header>
      <div class="base-dialog__body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="base-dialog__footer">
        <slot name="footer" />
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.base-dialog {
  width: min(560px, 92vw);
  max-width: none;
  padding: 0;
  border: none;
  border-radius: var(--radius-lg);
  background: transparent;
}

/* 宽版：表格/结构化正文（列多时 560px 只能看见五六列，其余全靠横向滚） */
.base-dialog--wide {
  width: min(900px, 94vw);
}

.base-dialog::backdrop {
  background: var(--color-overlay);
}

.base-dialog__panel {
  display: flex;
  flex-direction: column;
  max-height: 80vh;
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: 0 16px 40px rgb(15 20 30 / 22%);
}

.base-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.base-dialog__title {
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.base-dialog__close {
  display: inline-flex;
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.base-dialog__close:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.base-dialog__body {
  flex: 1;
  padding: var(--space-4);
  overflow-y: auto;
}

.base-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-4);
  border-top: 1px solid var(--color-border);
}
</style>
