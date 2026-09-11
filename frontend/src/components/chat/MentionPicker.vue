<script setup lang="ts">
/**
 * `@` 引用面板（T056，FR-014 / FR-019 / SC-016）
 *
 * 两阶段：目录列表（固定 9 项，取自 `constants/directories.ts`）→ 该目录的文件列表。
 * 键盘可达：`↑`/`↓` 派发 `move`、`Enter` 选中当前项（目录 → `pick-dir`，文件 → `pick-file`）、
 * `Esc` 派发 `close`；空目录给出空态提示（FR-019）。
 *
 * 组件不持有业务状态：选项与高亮均由 props 驱动，选择意图上抛给装配层。
 */
import { computed, nextTick, ref, watch } from 'vue'

import type { FileReference } from '../../api/types'
import { directoryLabel, type SpaceDirectory } from '../../constants/directories'
import BaseIcon from '../common/BaseIcon.vue'

const props = withDefaults(
  defineProps<{
    /** 是否展开 */
    open?: boolean
    /** 当前阶段 */
    stage?: 'dir' | 'file'
    /** 目录白名单（9 个，唯一来源） */
    directories: readonly SpaceDirectory[]
    /** 文件阶段的目标目录 */
    activeDir?: string | null
    /** 当前目录的文件清单 */
    files?: { filename: string }[]
    /** 键盘高亮项索引 */
    activeIndex?: number
    /** 文件清单加载中 */
    loading?: boolean
  }>(),
  {
    open: false,
    stage: 'dir',
    activeDir: null,
    files: () => [],
    activeIndex: 0,
    loading: false,
  },
)

const emit = defineEmits<{
  'pick-dir': [dir: string]
  'pick-file': [reference: FileReference]
  close: []
  move: [delta: number]
}>()

const listRef = ref<HTMLElement | null>(null)

const dirs = computed(() =>
  props.directories.map((directory) => ({
    key: directory.dir,
    label: directoryLabel(directory.dir),
  })),
)

const activeDirLabel = computed(() =>
  props.activeDir === null ? '' : directoryLabel(props.activeDir),
)

/** 当前目录下无可选文件（且不在加载中）。 */
const emptyDirs = computed(
  () => props.stage === 'file' && !props.loading && props.files.length === 0,
)

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) {
    return
  }
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      emit('move', 1)
      break
    case 'ArrowUp':
      event.preventDefault()
      emit('move', -1)
      break
    case 'Enter':
      event.preventDefault()
      confirmActive()
      break
    case 'Escape':
      event.preventDefault()
      emit('close')
      break
    default:
      break
  }
}

/** 回车确认当前高亮项（目录阶段选目录、文件阶段选文件）。 */
function confirmActive(): void {
  if (props.stage === 'dir') {
    const dir = props.directories[props.activeIndex]
    if (dir) {
      emit('pick-dir', dir.dir)
    }
    return
  }
  const file = props.files[props.activeIndex]
  if (file && props.activeDir !== null) {
    emit('pick-file', { dir: props.activeDir, filename: file.filename })
  }
}

// 高亮项滚动入视区（长列表键盘导航）
watch(
  () => props.activeIndex,
  () => {
    void nextTick(() => {
      listRef.value
        ?.querySelector<HTMLElement>('[data-active="true"]')
        ?.scrollIntoView?.({ block: 'nearest' })
    })
  },
)
</script>

<template>
  <div v-if="open" ref="listRef" class="mention-picker" role="listbox" @keydown="onKeydown">
    <p v-if="stage === 'file'" class="mention-picker__title">{{ activeDirLabel }}</p>

    <!-- 目录阶段：固定 9 项（SC-021） -->
    <template v-if="stage === 'dir'">
      <button
        v-for="(item, index) in dirs"
        :key="item.key"
        type="button"
        role="option"
        class="mention-picker__item"
        :class="{ 'mention-picker__item--active': index === activeIndex }"
        :aria-selected="index === activeIndex ? 'true' : 'false'"
        :data-active="index === activeIndex ? 'true' : 'false'"
        @click="emit('pick-dir', item.key)"
      >
        <BaseIcon name="folder" :size="14" />
        <span class="mention-picker__label">{{ item.label }}</span>
      </button>
    </template>

    <!-- 文件阶段 -->
    <template v-else>
      <p v-if="loading" class="mention-picker__hint">正在加载文件…</p>
      <p v-else-if="emptyDirs" class="mention-picker__empty">该目录暂无文件</p>
      <template v-else>
        <button
          v-for="(item, index) in files"
          :key="item.filename"
          type="button"
          role="option"
          class="mention-picker__item"
          :class="{ 'mention-picker__item--active': index === activeIndex }"
          :aria-selected="index === activeIndex ? 'true' : 'false'"
          :data-active="index === activeIndex ? 'true' : 'false'"
          @click="emit('pick-file', { dir: activeDir ?? '', filename: item.filename })"
        >
          <BaseIcon name="file" :size="14" />
          <span class="mention-picker__label">{{ item.filename }}</span>
        </button>
      </template>
    </template>
  </div>
</template>

<style scoped>
.mention-picker {
  max-height: 240px;
  overflow-y: auto;
  padding: var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 8px 24px rgb(15 20 30 / 14%);
}

.mention-picker__title {
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.mention-picker__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
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

.mention-picker__item--active {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.mention-picker__hint,
.mention-picker__empty {
  padding: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>
