<script lang="ts">
let titleSeq = 0

export function nextTitleId(): string {
  titleSeq += 1
  return `base-dialog-title-${titleSeq}`
}
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    width?: number
    /** 是否在右上角显示关闭按钮 */
    showClose?: boolean
  }>(),
  { width: 560, showClose: false },
)

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const titleId = nextTitleId()

const dialogEl = ref<HTMLDialogElement | null>(null)
let restoreFocusTo: HTMLElement | null = null

function openDialog(): void {
  const el = dialogEl.value
  if (!el) return
  restoreFocusTo = (document.activeElement as HTMLElement | null) ?? null
  // jsdom 早期版本没有 showModal：降级为设置 open 属性，保证行为可测
  if (typeof el.showModal === 'function') {
    if (!el.open) el.showModal()
  } else {
    el.setAttribute('open', '')
  }
  void nextTick().then(() => {
    dialogEl.value?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  })
}

function closeDialog(): void {
  const el = dialogEl.value
  if (el) {
    if (typeof el.close === 'function' && el.open) el.close()
    else el.removeAttribute('open')
  }
  restoreFocusTo?.focus?.()
  restoreFocusTo = null
}

function onCancel(event: Event): void {
  event.preventDefault()
  emit('update:open', false)
}

watch(
  () => props.open,
  async (isOpen) => {
    await nextTick()
    if (isOpen) openDialog()
    else closeDialog()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  const el = dialogEl.value
  if (el && typeof el.close === 'function' && el.open) el.close()
})
</script>

<template>
  <dialog
    ref="dialogEl"
    class="base-dialog"
    :style="{ maxWidth: `${width}px` }"
    :aria-labelledby="titleId"
    @cancel="onCancel"
  >
    <form method="dialog" class="base-dialog__body" @submit.prevent>
      <button
        v-if="showClose"
        type="button"
        class="base-dialog__close"
        aria-label="关闭"
        @click="emit('update:open', false)"
      >
        ×
      </button>
      <h2 :id="titleId" class="base-dialog__title">{{ title }}</h2>
      <div class="base-dialog__content">
        <slot />
      </div>
      <div v-if="$slots.footer" class="base-dialog__actions">
        <slot name="footer" />
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.base-dialog {
  position: relative;
  border: none;
  border-radius: var(--radius-lg);
  padding: 0;
  width: calc(100% - var(--space-6));
  box-shadow: 0 12px 32px rgb(15 20 30 / 24%);
  z-index: var(--z-index-dialog);
}

.base-dialog::backdrop {
  background: var(--color-overlay);
}

.base-dialog__body {
  padding: var(--space-5);
}

.base-dialog__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.base-dialog__close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.base-dialog__close:hover {
  background: var(--color-bg-muted);
  color: var(--color-text);
}

.base-dialog__content {
  margin-top: var(--space-4);
}

.base-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>
