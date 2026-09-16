<script setup lang="ts">
/**
 * 破坏性操作二次确认（`FR-007`）。
 *
 * **用原生 `<dialog>` + `showModal()`**（`research.md` D5）：焦点陷阱、
 * `aria-modal`、Esc 关闭由浏览器提供，避免自建 Modal 带来的可访问性退化。
 *
 * 关闭后焦点**归还**到触发元素（打开时记录 `document.activeElement`）。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    /** 破坏性操作用红色确认按钮 */
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

/** `cancel` 事件由 Esc 触发：阻止浏览器默认关闭，统一走 `update:open` 流程 */
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
