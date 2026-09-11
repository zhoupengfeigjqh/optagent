<script setup lang="ts">
/**
 * 工作空间文件抽屉（T076，FR-031 / FR-019）
 *
 * 基于 `BaseDialog`。按 9 个白名单目录（`constants/directories.ts`）分组展示文件，
 * **空目录也保留分组并给出空态**——让用户能区分"目录确实是空的"与"没加载出来"。
 * 点击文件 → 派发 `preview` 并收起面板；下载按钮 → 派发 `download`（直链无大小上限）。
 */
import { computed } from 'vue'

import type { FileReference, WorkspaceDir } from '../../api/types'
import { directoryLabel } from '../../constants/directories'
import { formatFileSize } from '../../utils/format'
import BaseDialog from '../common/BaseDialog.vue'
import LoadingDots from '../common/LoadingDots.vue'

const props = withDefaults(
  defineProps<{
    /** 是否展开 */
    open?: boolean
    /** 9 个目录及其文件（空目录 `files=[]`） */
    dirs?: WorkspaceDir[]
    /** 加载中 */
    loading?: boolean
  }>(),
  { open: false, dirs: () => [], loading: false },
)

const emit = defineEmits<{
  close: []
  preview: [reference: FileReference]
  download: [reference: FileReference]
}>()

/** 分组：展示名取目录白名单口径，顺序即白名单顺序 */
const groups = computed(() =>
  props.dirs.map((group) => ({
    dir: group.dir,
    label: directoryLabel(group.dir),
    files: group.files,
  })),
)

function onPreview(dir: string, filename: string): void {
  emit('preview', { dir, filename })
  emit('close')
}

function onDownload(dir: string, filename: string): void {
  emit('download', { dir, filename })
}
</script>

<template>
  <BaseDialog class="workspace-drawer" :open="open" title="工作空间文件" @close="emit('close')">
    <LoadingDots v-if="loading" label="正在加载工作空间" />

    <p v-else-if="groups.length === 0" class="workspace-drawer__hint">暂无目录</p>

    <template v-else>
      <section
        v-for="group in groups"
        :key="group.dir"
        class="workspace-drawer__group"
      >
        <h3 class="workspace-drawer__group-title">{{ group.label }}</h3>

        <ul v-if="group.files.length > 0" class="workspace-drawer__files">
          <li v-for="file in group.files" :key="file.filename" class="workspace-drawer__file">
            <button
              type="button"
              class="workspace-drawer__open"
              :title="`预览 ${file.filename}`"
              @click="onPreview(group.dir, file.filename)"
            >
              {{ file.filename }}
            </button>
            <span class="workspace-drawer__size">{{ formatFileSize(file.size) }}</span>
            <button
              type="button"
              class="workspace-drawer__download"
              :aria-label="`下载 ${file.filename}`"
              @click="onDownload(group.dir, file.filename)"
            >
              下载
            </button>
          </li>
        </ul>

        <p v-else class="workspace-drawer__hint workspace-drawer__empty">该目录暂无文件</p>
      </section>
    </template>
  </BaseDialog>
</template>

<style scoped>
.workspace-drawer__group + .workspace-drawer__group {
  margin-top: var(--space-4);
}

.workspace-drawer__group-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.workspace-drawer__files {
  margin-top: var(--space-1);
}

.workspace-drawer__file {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  font-size: var(--font-size-sm);
}

.workspace-drawer__open {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  border: none;
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.workspace-drawer__size {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.workspace-drawer__download {
  flex: none;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-xs);
  cursor: pointer;
}

.workspace-drawer__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.workspace-drawer__empty {
  margin-top: var(--space-1);
  font-size: var(--font-size-xs);
}
</style>
