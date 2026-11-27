<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

import type { FileReference, WorkspaceDir, WorkspaceSpace } from '../../api/types'
import BaseIcon from '../common/BaseIcon.vue'
import type { MentionColumn } from '../../composables/useFileMention'

const props = withDefaults(
  defineProps<{
    open?: boolean
    spaces?: WorkspaceSpace[]
    column?: MentionColumn
    activeSpace?: string | null
    activeDir?: string | null
    dirs?: WorkspaceDir[]
    files?: { filename: string }[]
    activeIndex?: number
    loading?: boolean
  }>(),
  {
    open: false,
    spaces: () => [],
    column: 'space',
    activeSpace: null,
    activeDir: null,
    dirs: () => [],
    files: () => [],
    activeIndex: 0,
    loading: false,
  },
)

const emit = defineEmits<{
  'pick-space': [space: string]
  'pick-dir': [dir: string]
  'pick-file': [reference: FileReference]
  close: []
  move: [delta: number]
  confirm: []
  back: []
}>()

const listRef = ref<HTMLElement | null>(null)

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
    case 'ArrowRight':
      event.preventDefault()
      emit('confirm')
      break
    case 'ArrowLeft':
      event.preventDefault()
      emit('back')
      break
    case 'Enter':
      event.preventDefault()
      emit('confirm')
      break
    case 'Escape':
      event.preventDefault()
      emit('close')
      break
    default:
      break
  }
}

function isActive(column: MentionColumn, index: number): boolean {
  return props.column === column && props.activeIndex === index
}

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
    <div class="mention-picker__column">
      <button
        v-for="(space, index) in spaces"
        :key="space.name"
        type="button"
        role="option"
        class="mention-picker__item"
        :class="{
          'mention-picker__item--active': isActive('space', index),
          'mention-picker__item--expanded': activeSpace === space.name,
        }"
        :aria-selected="isActive('space', index) ? 'true' : 'false'"
        :data-active="isActive('space', index) ? 'true' : 'false'"
        @click="emit('pick-space', space.name)"
      >
        <BaseIcon name="folder" :size="14" />
        <span class="mention-picker__label">{{ space.name }}</span>
        <BaseIcon name="chevron-right" :size="12" class="mention-picker__caret" />
      </button>
      <p v-if="spaces.length === 0 && !loading" class="mention-picker__empty">暂无可选空间</p>
    </div>

    <div v-if="column !== 'space' && dirs.length > 0" class="mention-picker__column">
      <button
        v-for="(item, index) in dirs"
        :key="item.dir"
        type="button"
        role="option"
        class="mention-picker__item"
        :class="{
          'mention-picker__item--active': isActive('dir', index),
          'mention-picker__item--expanded': activeDir === item.dir,
        }"
        :aria-selected="isActive('dir', index) ? 'true' : 'false'"
        :data-active="isActive('dir', index) ? 'true' : 'false'"
        @click="emit('pick-dir', item.dir)"
      >
        <BaseIcon name="folder" :size="14" />
        <span class="mention-picker__label">{{ item.label }}</span>
        <BaseIcon name="chevron-right" :size="12" class="mention-picker__caret" />
      </button>
    </div>

    <div v-if="column === 'file'" class="mention-picker__column">
      <p v-if="loading" class="mention-picker__hint">正在加载文件…</p>
      <p v-else-if="files.length === 0" class="mention-picker__empty">该目录暂无文件</p>
      <template v-else>
        <button
          v-for="(item, index) in files"
          :key="item.filename"
          type="button"
          role="option"
          class="mention-picker__item"
          :class="{ 'mention-picker__item--active': isActive('file', index) }"
          :aria-selected="isActive('file', index) ? 'true' : 'false'"
          :data-active="isActive('file', index) ? 'true' : 'false'"
          @click="emit('pick-file', { dir: activeDir ?? '', filename: item.filename })"
        >
          <BaseIcon name="file" :size="14" />
          <span class="mention-picker__label">{{ item.filename }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mention-picker {
  display: flex;
  align-items: flex-start;
  max-height: 240px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 8px 24px rgb(15 20 30 / 14%);
}

.mention-picker__column {
  min-width: 140px;
  max-height: 240px;
  overflow-y: auto;
  padding: var(--space-1);
}

.mention-picker__column + .mention-picker__column {
  border-left: 1px solid var(--color-border);
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

.mention-picker__item--active,
.mention-picker__item--expanded {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.mention-picker__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mention-picker__caret {
  flex: none;
  color: var(--color-text-muted);
}

.mention-picker__hint,
.mention-picker__empty {
  padding: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  white-space: nowrap;
}
</style>
