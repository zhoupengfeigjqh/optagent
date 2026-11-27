<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
  }>(),
  {
    message: '',
    confirmLabel: '确认',
    cancelLabel: '取消',
    danger: false,
  },
)

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm'): void
}>()

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

function requestClose(): void {
  emit('update:open', false)
}

function onConfirm(): void {
  emit('confirm')
  emit('update:open', false)
}

function onCancel(event: Event): void {
  event.preventDefault()
  requestClose()
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
    class="confirm-dialog"
    aria-labelledby="confirm-dialog-title"
    @cancel="onCancel"
  >
    <form method="dialog" class="confirm-dialog__body" @submit.prevent>
      <h2 id="confirm-dialog-title" class="confirm-dialog__title">{{ title }}</h2>
      <p v-if="message" class="confirm-dialog__message">{{ message }}</p>
      <div v-if="$slots.default" class="confirm-dialog__extra">
        <slot />
      </div>
      <div class="confirm-dialog__actions">
        <button type="button" class="btn" data-test="cancel" @click="requestClose">
          {{ cancelLabel }}
        </button>
        <button
          type="button"
          class="btn"
          :class="danger ? 'btn--danger' : 'btn--primary'"
          data-test="confirm"
          @click="onConfirm"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.confirm-dialog {
  border: none;
  border-radius: var(--radius-lg);
  padding: 0;
  max-width: 520px;
  width: calc(100% - var(--space-6));
  box-shadow: 0 12px 32px rgb(15 20 30 / 24%);
  z-index: var(--z-index-dialog);
}

.confirm-dialog::backdrop {
  background: var(--color-overlay);
}

.confirm-dialog__body {
  padding: var(--space-5);
}

.confirm-dialog__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.confirm-dialog__message {
  margin: var(--space-3) 0 0;
  color: var(--color-text-secondary);
  line-height: var(--line-height-base);
}

.confirm-dialog__extra {
  margin-top: var(--space-3);
}

.confirm-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>
