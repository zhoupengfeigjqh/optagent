<script setup lang="ts">
/**
 * 文件空间树（US8，三空间分层）
 *
 * 结构以后端 `GET /api/files/workspace` 下发为准，与加号上传入口、`@` 引用面板同构：
 * - 一级：**三个空间**（数据准备 / 共享空间 / 临时空间）
 * - 二级：仅**数据准备**有（scenario 定义的子目录）
 * - 三级：文件行（`WorkspaceFileList`）
 *
 * 共享空间 / 临时空间为**扁平空间**（`dirs` 仅含空间自身），展开空间即直接出文件；
 * 该判定与 `@` 面板共用 `utils/space.ts`，避免两处各写一套。
 *
 * **默认全部收起**（FR-031）；一级/二级展开状态由 `useWorkspace` 经 props 注入
 * （本次会话内保持，面板收起不重置）。纯展示：不发起请求，删除的二次确认由 `WorkspacePanel` 承担。
 */
import type { FileReference, WorkspaceSpace } from '../../api/types'
import { isFlatSpace, spaceFileCount, spaceSubDirs } from '../../utils/space'
import BaseIcon from '../common/BaseIcon.vue'
import LoadingDots from '../common/LoadingDots.vue'
import WorkspaceFileList from './WorkspaceFileList.vue'

const props = withDefaults(
  defineProps<{
    /** 三空间树（后端 workspace 下发） */
    spaces?: WorkspaceSpace[]
    /** 已展开的空间名（空数组 = 全部收起） */
    expandedSpaces?: readonly string[]
    /** 已展开的二级目录路径（空数组 = 全部收起） */
    expandedDirs?: readonly string[]
    /** 加载中 */
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
      <!-- 一级：空间（数据准备 / 共享空间 / 临时空间） -->
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
        <!-- 扁平空间（共享空间 / 临时空间）：展开空间直接出文件 -->
        <template v-if="isFlatSpace(space)">
          <WorkspaceFileList
            v-if="space.dirs.length > 0 && space.dirs[0].files.length > 0"
            :dir="space.dirs[0].dir"
            :files="space.dirs[0].files"
            :deletable="space.dirs[0].deletable"
            @preview="emit('preview', $event)"
            @download="emit('download', $event)"
            @remove="emit('remove', $event)"
          />
          <p v-else class="workspace-tree__hint workspace-tree__empty">该空间暂无文件</p>
        </template>

        <!-- 数据准备：展开二级子目录，子目录再展开出文件 -->
        <ul v-else class="workspace-tree__dirs">
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
                :deletable="dir.deletable"
                @preview="emit('preview', $event)"
                @download="emit('download', $event)"
                @remove="emit('remove', $event)"
              />
              <p v-else class="workspace-tree__hint workspace-tree__empty">该目录暂无文件</p>
            </div>
          </li>
        </ul>
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

/* 逐级缩进：一级之下（子目录 / 扁平空间文件）与子目录之下的文件各缩进一次 */
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
