<script setup lang="ts">
import { computed, onMounted, ref, useId, watch } from 'vue'

import BaseIcon from './BaseIcon.vue'

const props = withDefaults(
  defineProps<{
    open?: boolean
    title?: string
    labelledBy?: string | null
    wide?: boolean
  }>(),
  { open: false, title: '', labelledBy: null, wide: false },
)

const emit = defineEmits<{ close: [] }>()

const dialogRef = ref<HTMLDialogElement | null>(null)
const titleId = `base-dialog-title-${useId()}`
const labelId = computed(() => props.labelledBy ?? (props.title ? titleId : null))

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
        <slot name="header-extra" />
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
  margin: auto;
  width: min(560px, 92vw);
  max-width: none;
  padding: 0;
  border: none;
  border-radius: var(--radius-lg);
  background: transparent;
}

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
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.base-dialog__title {
  min-width: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.base-dialog__close {
  display: inline-flex;
  margin-left: auto;
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
