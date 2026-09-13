<script setup lang="ts">
/**
 * 文件空间文件树（US8）
 *
 * 按 `constants/directories.ts` 的 9 个固定白名单目录分组，**默认全部收起**；
 * 展开状态由 `useWorkspace.expandedDirs` 经 props 注入（本次会话内保持，面板收起不重置）。
 *
 * 每个文件行提供三个入口：查看（进内容态）、下载、删除。
 * `shared` 为共享只读目录（后端 403 `FILE_READONLY` 兜底），界面**不渲染删除入口**。
 *
 * 纯展示：不发起请求；删除的二次确认由 `WorkspacePanel` 承担，本组件只上报意图。
 */
import type { FileReference, WorkspaceDir } from '../../api/types'
import { SHARED_DIR, directoryLabel } from '../../constants/directories'
import { formatFileSize } from '../../utils/format'
import BaseIcon from '../common/BaseIcon.vue'
import LoadingDots from '../common/LoadingDots.vue'

const props = withDefaults(
  defineProps<{
    /** 9 个目录及其文件（空目录 `files=[]`） */
    dirs?: WorkspaceDir[]
    /** 已展开的目录名（空数组 = 全部收起） */
    expandedDirs?: readonly string[]
    /** 加载中 */
    loading?: boolean
  }>(),
  { dirs: () => [], expandedDirs: () => [], loading: false },
)

const emit = defineEmits<{
  'toggle-dir': [dir: string]
  preview: [reference: FileReference]
  download: [reference: FileReference]
  remove: [reference: FileReference]
}>()

function isExpanded(dir: string): boolean {
  return props.expandedDirs.includes(dir)
}

/** 共享目录只读：不提供删除入口（后端亦会拒绝） */
function canRemove(dir: string): boolean {
  return dir !== SHARED_DIR
}
</script>

<template>
  <LoadingDots v-if="loading" label="正在加载文件空间" />

  <p v-else-if="dirs.length === 0" class="workspace-tree__hint">暂无目录</p>

  <ul v-else class="workspace-tree__groups" aria-label="文件空间目录">
    <li v-for="group in dirs" :key="group.dir" class="workspace-tree__group">
      <!-- 分组头：收起/展开（默认收起，空目录同样可展开并给出空态） -->
      <button
        type="button"
        class="workspace-tree__group-toggle"
        :aria-expanded="isExpanded(group.dir)"
        @click="emit('toggle-dir', group.dir)"
      >
        <BaseIcon
          :name="isExpanded(group.dir) ? 'chevron-down' : 'chevron-right'"
          :size="14"
        />
        <BaseIcon name="folder" :size="14" />
        <span class="workspace-tree__group-name">{{ directoryLabel(group.dir) }}</span>
        <span class="workspace-tree__count">{{ group.files.length }}</span>
      </button>

      <template v-if="isExpanded(group.dir)">
        <ul v-if="group.files.length > 0" class="workspace-tree__files">
          <li v-for="file in group.files" :key="file.filename" class="workspace-tree__file">
            <button
              type="button"
              class="workspace-tree__open"
              :title="`查看 ${file.filename}`"
              @click="emit('preview', { dir: group.dir, filename: file.filename })"
            >
              <BaseIcon name="file" :size="14" />
              <span class="workspace-tree__filename">{{ file.filename }}</span>
            </button>

            <span class="workspace-tree__size">{{ formatFileSize(file.size) }}</span>

            <button
              type="button"
              class="workspace-tree__action"
              :aria-label="`下载 ${file.filename}`"
              title="下载"
              @click="emit('download', { dir: group.dir, filename: file.filename })"
            >
              <BaseIcon name="download" :size="14" />
            </button>

            <button
              v-if="canRemove(group.dir)"
              type="button"
              class="workspace-tree__action workspace-tree__action--danger"
              :aria-label="`删除 ${file.filename}`"
              title="删除"
              @click="emit('remove', { dir: group.dir, filename: file.filename })"
            >
              <BaseIcon name="trash" :size="14" />
            </button>
          </li>
        </ul>

        <p v-else class="workspace-tree__hint workspace-tree__empty">该目录暂无文件</p>
      </template>
    </li>
  </ul>
</template>

<style scoped>
.workspace-tree__groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.workspace-tree__group-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.workspace-tree__group-toggle:hover {
  background: var(--color-bg-subtle);
}

.workspace-tree__group-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.workspace-tree__count {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 400;
}

.workspace-tree__files {
  display: flex;
  flex-direction: column;
  padding-left: var(--space-5);
}

.workspace-tree__file {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}

.workspace-tree__file:hover {
  background: var(--color-bg-subtle);
}

.workspace-tree__open {
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

.workspace-tree__filename {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.workspace-tree__size {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.workspace-tree__action {
  display: inline-flex;
  flex: none;
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.workspace-tree__action:hover {
  background: var(--color-bg);
  color: var(--color-text);
}

.workspace-tree__action--danger:hover {
  color: var(--color-status-error);
}

.workspace-tree__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.workspace-tree__empty {
  padding-left: var(--space-5);
  font-size: var(--font-size-xs);
}
</style>
