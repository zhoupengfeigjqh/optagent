<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { ScenarioField, WorkspaceSpace } from '../../api/types'
import type { UploadedDocument } from '../../composables/useUploads'
import { uploadExtensionsOfDir } from '../../composables/useWorkspace'
import BaseButton from '../common/BaseButton.vue'
import BaseIcon from '../common/BaseIcon.vue'
import HintTip from '../common/HintTip.vue'
import UploadItem from './UploadItem.vue'

const props = withDefaults(
  defineProps<{
    open?: boolean
    spaces?: WorkspaceSpace[]
    uploads?: UploadedDocument[]
  }>(),
  { open: false, spaces: () => [], uploads: () => [] },
)

const emit = defineEmits<{
  close: []
  pick: [payload: { dir: string; files: FileList }]
  retry: [localId: string]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const activeDir = ref<string | null>(null)

const activeAccept = computed(() => {
  const dir = activeDir.value
  if (!dir) return ''
  return uploadExtensionsOfDir(
    props.spaces.flatMap((space) => space.dirs),
    dir,
  ).join(',')
})

function chooseDir(dir: string): void {
  activeDir.value = dir
  const input = inputRef.value
  if (!input) {
    return
  }
  // 允许重复选择同一文件（否则 change 不再触发）
  input.value = ''
  input.click()
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const dir = activeDir.value
  const files = input.files
  if (dir !== null && files !== null && files.length > 0) {
    emit('pick', { dir, files })
  }
  input.value = ''
  activeDir.value = null
}

function onRetry(localId: string): void {
  emit('retry', localId)
}

function onEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (document.querySelector('dialog[open]') !== null) return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}

let escapeAttached = false

function attachEscape(): void {
  if (escapeAttached || typeof window === 'undefined') return
  window.addEventListener('keydown', onEscape, true)
  escapeAttached = true
}

function detachEscape(): void {
  if (!escapeAttached || typeof window === 'undefined') return
  window.removeEventListener('keydown', onEscape, true)
  escapeAttached = false
}

watch(
  () => props.open,
  (open) => (open ? attachEscape() : detachEscape()),
  { immediate: true },
)

onBeforeUnmount(detachEscape)

function fieldHint(fields: readonly ScenarioField[]): string {
  const required = fields.filter((f) => f.required).map((f) => f.name)
  const optional = fields.filter((f) => !f.required).map((f) => `${f.name}(${f.type})`)
  const parts: string[] = []
  if (required.length > 0) parts.push(`表头须含：${required.join('、')}`)
  if (optional.length > 0) parts.push(`可选：${optional.join('、')}`)
  return parts.join('；')
}
</script>

<template>
  <div v-if="open" class="upload-menu">
    <header class="upload-menu__header">
      <p class="upload-menu__title">上传文件</p>
      <BaseButton
        class="upload-menu__close"
        variant="ghost"
        size="sm"
        aria-label="关闭上传面板"
        title="关闭上传面板（Esc）"
        @click="emit('close')"
      >
        <BaseIcon name="close" :size="14" />
      </BaseButton>
    </header>

    <div v-for="space in spaces" :key="space.name" class="upload-menu__space">
      <p class="upload-menu__space-title">{{ space.name }}</p>
      <ul class="upload-menu__dirs">
        <li v-for="directory in space.dirs" :key="directory.dir" class="upload-menu__dir">
          <div class="upload-menu__dir-row">
            <button type="button" class="upload-menu__dir-button" @click="chooseDir(directory.dir)">
              <BaseIcon name="folder" :size="14" />
              <span class="upload-menu__dir-label">{{ directory.label }}</span>
            </button>
            <HintTip
              v-if="directory.fields.length > 0"
              :text="fieldHint(directory.fields)"
              label="查看表头要求"
            />
            <span
              class="upload-menu__dir-exts"
              :class="{ 'upload-menu__dir-exts--after-hint': directory.fields.length > 0 }"
              >{{ directory.upload_extensions.join(' ') }}</span
            >
          </div>
        </li>
      </ul>
    </div>

    <p v-if="spaces.length === 0" class="upload-menu__empty">文件空间加载中或尚未配置场景</p>

    <input
      ref="inputRef"
      class="upload-menu__input"
      type="file"
      multiple
      hidden
      :accept="activeAccept"
      @change="onFileChange"
    />

    <ul v-if="uploads.length" class="upload-menu__uploads">
      <UploadItem
        v-for="doc in uploads"
        :key="doc.localId"
        :doc="doc"
        @retry="onRetry(doc.localId)"
      />
    </ul>
  </div>
</template>

<style scoped>
.upload-menu {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.upload-menu__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-left: var(--space-2);
}

.upload-menu__title {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

/* BaseButton 的 sm 尺寸带左右 12px 内边距，这里收成方形，避免「×」被撑成大按钮 */
.upload-menu__close {
  padding: var(--space-1);
}

.upload-menu__space-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0;
  padding: 0 var(--space-2);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.upload-menu__dirs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-1);
}

.upload-menu__dir {
  display: flex;
  flex-direction: column;
}

.upload-menu__dir-exts {
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.4;
  word-break: break-word;
}

/* 类型前面有「?」→ 留 4px 气口；无「?」（共享/临时空间）→ 紧贴文件名右侧 */
.upload-menu__dir-exts--after-hint {
  padding-left: var(--space-1);
}

.upload-menu__dir-row {
  display: flex;
  align-items: center;
  /*
   * 不设 `flex-wrap`：目录名 +「?」+ 类型始终在**同一条 flex 行**上，
   * 类型过长时在自身盒内折行（`min-width: 0`），从而第一段类型紧贴名字右侧，
   * 而不会整段被挤到下一行（那会让「临时空间」这种无「?」的目录看起来是两段）。
   */
}

.upload-menu__dir-button {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
}

.upload-menu__dir-button:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.upload-menu__empty {
  padding: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.upload-menu__uploads {
  max-height: 6.5rem;
  overflow-y: auto;
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-1);
}
</style>
