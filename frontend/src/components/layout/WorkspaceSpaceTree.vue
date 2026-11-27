<script setup lang="ts">
import type { FileReference, WorkspaceSpace } from '../../api/types'
import { isFlatSpace, spaceFileCount, spaceSubDirs } from '../../utils/space'
import BaseIcon from '../common/BaseIcon.vue'
import LoadingDots from '../common/LoadingDots.vue'
import WorkspaceFileList from './WorkspaceFileList.vue'

const props = withDefaults(
  defineProps<{
    spaces?: WorkspaceSpace[]
    expandedSpaces?: readonly string[]
    expandedDirs?: readonly string[]
    loading?: boolean
  }>(),
  { spaces: () => [], expandedSpaces: () => [], expandedDirs: () => [], loading: false },
)

const emit = defineEmits<{
  'toggle-space': [name: string]
  'toggle-dir': [dir: string]
  preview: [reference: FileReference]
  download: [reference: FileReference]
  remove: [reference: FileReference]
}>()

function isSpaceExpanded(name: string): boolean {
  return props.expandedSpaces.includes(name)
}

function isDirExpanded(dir: string): boolean {
  return props.expandedDirs.includes(dir)
}
</script>

<template>
  <LoadingDots v-if="loading" label="正在加载文件空间" />

  <p v-else-if="spaces.length === 0" class="workspace-tree__hint">暂无目录</p>

  <ul v-else class="workspace-tree__spaces" aria-label="文件空间">
    <li v-for="space in spaces" :key="space.name" class="workspace-tree__space">
      <button
        type="button"
        class="workspace-tree__toggle"
        :aria-expanded="isSpaceExpanded(space.name)"
        @click="emit('toggle-space', space.name)"
      >
        <BaseIcon
          :name="isSpaceExpanded(space.name) ? 'chevron-down' : 'chevron-right'"
          :size="14"
        />
        <BaseIcon name="folder" :size="14" />
        <span class="workspace-tree__name">{{ space.name }}</span>
        <span class="workspace-tree__count">{{ spaceFileCount(space) }}</span>
      </button>

      <div v-if="isSpaceExpanded(space.name)" class="workspace-tree__nest">
        <template v-if="isFlatSpace(space)">
          <WorkspaceFileList
            v-if="space.dirs.length > 0 && space.dirs[0].files.length > 0"
            :dir="space.dirs[0].dir"
            :files="space.dirs[0].files"
            @preview="emit('preview', $event)"
            @download="emit('download', $event)"
            @remove="emit('remove', $event)"
          />
          <p v-else class="workspace-tree__hint workspace-tree__empty">该空间暂无文件</p>
        </template>

        <template v-else-if="spaceSubDirs(space).length > 0">
          <ul class="workspace-tree__dirs">
            <li v-for="dir in spaceSubDirs(space)" :key="dir.dir" class="workspace-tree__dir">
              <button
                type="button"
                class="workspace-tree__dir-toggle"
                :aria-expanded="isDirExpanded(dir.dir)"
                @click="emit('toggle-dir', dir.dir)"
              >
                <BaseIcon
                  :name="isDirExpanded(dir.dir) ? 'chevron-down' : 'chevron-right'"
                  :size="14"
                />
                <BaseIcon name="folder" :size="14" />
                <span class="workspace-tree__name">{{ dir.label }}</span>
                <span class="workspace-tree__count">{{ dir.files.length }}</span>
              </button>

              <div v-if="isDirExpanded(dir.dir)" class="workspace-tree__nest">
                <WorkspaceFileList
                  v-if="dir.files.length > 0"
                  :dir="dir.dir"
                  :files="dir.files"
                  @preview="emit('preview', $event)"
                  @download="emit('download', $event)"
                  @remove="emit('remove', $event)"
                />
                <p v-else class="workspace-tree__hint workspace-tree__empty">该目录暂无文件</p>
              </div>
            </li>
          </ul>
        </template>
        <p v-else class="workspace-tree__hint workspace-tree__empty">
          该数字人未开放「数据准备」目录
        </p>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.workspace-tree__spaces {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.workspace-tree__toggle,
.workspace-tree__dir-toggle {
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
  text-align: left;
  cursor: pointer;
}

.workspace-tree__toggle {
  font-weight: 600;
}

.workspace-tree__toggle:hover,
.workspace-tree__dir-toggle:hover {
  background: var(--color-bg-subtle);
}

.workspace-tree__nest {
  padding-left: var(--space-5);
}

.workspace-tree__dirs {
  display: flex;
  flex-direction: column;
}

.workspace-tree__name {
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

.workspace-tree__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.workspace-tree__empty {
  padding-left: var(--space-2);
  font-size: var(--font-size-xs);
}
</style>
