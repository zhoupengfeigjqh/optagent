<script setup lang="ts">
/**
 * 文件行列表（US8）
 *
 * 右侧文件空间树在**两处**渲染文件行（扁平空间的直接文件、数据准备子目录内的文件），
 * 故抽成本组件，保证两处入口与样式完全一致：
 * 查看（进内容态）、下载、删除。
 *
 * 只读目录（`deletable=false`，如共享空间）**不渲染删除入口**（后端另有 403 兜底）。
 * 纯展示：不发起请求；删除的二次确认由 `WorkspacePanel` 承担，本组件只上报意图。
 */
import type { FileReference, WorkspaceFile } from '../../api/types'
import { formatFileSize } from '../../utils/format'
import BaseIcon from '../common/BaseIcon.vue'

const props = withDefaults(
  defineProps<{
    /** 这些文件所属的目录（相对空间路径，用于构造文件引用） */
    dir: string
    /** 文件清单（空数组时由调用方渲染空态文案） */
    files?: WorkspaceFile[]
    /** 该目录内文件是否可删除 */
    deletable?: boolean
  }>(),
  { files: () => [], deletable: false },
)

const emit = defineEmits<{
  preview: [reference: FileReference]
  download: [reference: FileReference]
  remove: [reference: FileReference]
}>()

function referenceOf(filename: string): FileReference {
  return { dir: props.dir, filename }
}
</script>

<template>
  <ul class="workspace-files" aria-label="文件">
    <li v-for="file in files" :key="file.filename" class="workspace-files__row">
      <button
        type="button"
        class="workspace-files__open"
        :title="`查看 ${file.filename}`"
        @click="emit('preview', referenceOf(file.filename))"
      >
        <BaseIcon name="file" :size="14" />
        <span class="workspace-files__name">{{ file.filename }}</span>
      </button>

      <span class="workspace-files__size">{{ formatFileSize(file.size) }}</span>

      <button
        type="button"
        class="workspace-files__action"
        :aria-label="`下载 ${file.filename}`"
        title="下载"
        @click="emit('download', referenceOf(file.filename))"
      >
        <BaseIcon name="download" :size="14" />
      </button>

      <button
        v-if="deletable"
        type="button"
        class="workspace-files__action workspace-files__action--danger"
        :aria-label="`删除 ${file.filename}`"
        title="删除"
        @click="emit('remove', referenceOf(file.filename))"
      >
        <BaseIcon name="trash" :size="14" />
      </button>
    </li>
  </ul>
</template>

<style scoped>
.workspace-files {
  display: flex;
  flex-direction: column;
}

.workspace-files__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}

.workspace-files__row:hover {
  background: var(--color-bg-subtle);
}

.workspace-files__open {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: var(--space-2);
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.workspace-files__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.workspace-files__size {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.workspace-files__action {
  display: inline-flex;
  flex: none;
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.workspace-files__action:hover {
  background: var(--color-bg);
  color: var(--color-text);
}

.workspace-files__action--danger:hover {
  color: var(--color-status-error);
}
</style>
