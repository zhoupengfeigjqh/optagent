<script setup lang="ts">
/**
 * 上传入口面板（T052，FR-009 / SC-021）
 *
 * 固定渲染 **9 个**空间目录入口，目录集合一律取自 `constants/directories.ts`
 * （禁止硬编码，三处引用同一常量）。
 *
 * 只用一个隐藏 `<input type="file">`：点击目录时记录目标目录并触发文件选择，
 * `change` 时把 `{ dir, files }` 交给上层（多选由 `useUploads` 逐文件各发一次请求）。
 */
import { ref } from 'vue'

import { directoryLabel, type SpaceDirectory } from '../../constants/directories'
import type { UploadedDocument } from '../../composables/useUploads'
import BaseIcon from '../common/BaseIcon.vue'
import UploadItem from './UploadItem.vue'

withDefaults(
  defineProps<{
    /** 是否展开 */
    open?: boolean
    /** 目录白名单（9 个） */
    directories: readonly SpaceDirectory[]
    /** 上传项（含失败原因与重试） */
    uploads?: UploadedDocument[]
  }>(),
  { open: false, uploads: () => [] },
)

const emit = defineEmits<{
  close: []
  pick: [payload: { dir: string; files: FileList }]
  retry: [localId: string]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
/** 本次文件选择的目标目录 */
const activeDir = ref<string | null>(null)

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
</script>

<template>
  <div v-if="open" class="upload-menu">
    <ul class="upload-menu__dirs">
      <li v-for="directory in directories" :key="directory.dir" class="upload-menu__dir">
        <button type="button" class="upload-menu__dir-button" @click="chooseDir(directory.dir)">
          <BaseIcon name="folder" :size="14" />
          <span class="upload-menu__dir-label">{{ directoryLabel(directory.dir) }}</span>
        </button>
      </li>
    </ul>

    <input
      ref="inputRef"
      class="upload-menu__input"
      type="file"
      multiple
      hidden
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

.upload-menu__dirs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-1);
}

.upload-menu__dir-button {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-1) var(--space-2);
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

.upload-menu__uploads {
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-1);
}
</style>
