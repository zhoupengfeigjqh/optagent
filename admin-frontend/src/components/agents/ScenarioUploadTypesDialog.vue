<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { DATA_PREP_UPLOAD_EXTS, DEFAULT_DATA_PREP_UPLOADS } from '../../constants/agent-design'

const props = defineProps<{
  open: boolean
  dir: string
  extensions: string[]
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'save', extensions: string[]): void
}>()

const candidates = DATA_PREP_UPLOAD_EXTS

const selected = ref<string[]>([])
const dialogEl = ref<HTMLDialogElement | null>(null)
let restoreFocusTo: HTMLElement | null = null

const canSave = computed(() => selected.value.length > 0)
const selectedCount = computed(() => selected.value.length)

function toggle(ext: string): void {
  const index = selected.value.indexOf(ext)
  if (index >= 0) selected.value.splice(index, 1)
  else selected.value.push(ext)
}

/** 保存时按候选枚举固定顺序排列（与服务端归一顺序一致，避免无谓字节差异） */
function orderedSelection(): string[] {
  return candidates.filter((ext) => selected.value.includes(ext))
}

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

function onSave(): void {
  if (!canSave.value) return
  emit('save', orderedSelection())
  emit('update:open', false)
}

function onCancel(event: Event): void {
  event.preventDefault()
  requestClose()
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      selected.value =
        props.extensions.length > 0 ? [...props.extensions] : [...DEFAULT_DATA_PREP_UPLOADS]
    }
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
    class="upload-dialog"
    data-test="scenario-upload-types-dialog"
    aria-labelledby="scenario-upload-types-title"
    @cancel="onCancel"
  >
    <form method="dialog" class="upload-dialog__body" @submit.prevent>
      <h2 id="scenario-upload-types-title" class="upload-dialog__title">
        可上传文件类型：{{ dir }}
      </h2>
      <p class="upload-dialog__hint">
        勾选该目录允许上传的文件类型，至少选择一种。未配置的目录使用平台默认（.csv 与 .xlsx）；
        共享空间与临时空间不受此配置影响。
      </p>

      <ul class="upload-dialog__list">
        <li v-for="ext in candidates" :key="ext" class="upload-dialog__item">
          <label class="upload-dialog__option">
            <input
              type="checkbox"
              :data-test="`upload-ext-${ext}`"
              :checked="selected.includes(ext)"
              @change="toggle(ext)"
            />
            <span class="mono">{{ ext }}</span>
          </label>
        </li>
      </ul>

      <p class="upload-dialog__count" data-test="selected-count" aria-live="polite">
        已选 {{ selectedCount }} / {{ candidates.length }} 项
      </p>

      <p v-if="!canSave" class="upload-dialog__error" role="alert" data-test="no-selection">
        至少选择一种文件类型
      </p>

      <div class="upload-dialog__actions">
        <button type="button" class="btn" data-test="cancel" @click="requestClose">取消</button>
        <button
          type="button"
          class="btn btn--primary"
          data-test="save"
          :disabled="!canSave"
          @click="onSave"
        >
          保存
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.upload-dialog {
  border: none;
  border-radius: var(--radius-lg);
  padding: 0;
  max-width: 640px;
  width: calc(100% - var(--space-6));
  box-shadow: 0 12px 32px rgb(15 20 30 / 24%);
  z-index: var(--z-index-dialog);
}

.upload-dialog::backdrop {
  background: var(--color-overlay);
}

.upload-dialog__body {
  padding: var(--space-5);
}

.upload-dialog__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.upload-dialog__hint {
  margin: var(--space-2) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}

.upload-dialog__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: var(--space-1) var(--space-3);
  margin: var(--space-3) 0;
  padding: 0;
  list-style: none;
}

.upload-dialog__option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.upload-dialog__count {
  margin: var(--space-2) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.upload-dialog__error {
  margin: var(--space-2) 0 0;
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
}

.upload-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>
