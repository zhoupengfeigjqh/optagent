<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

import type { Conversation } from '../../api/types'
import { formatTimestamp } from '../../utils/format'
import BaseIcon from '../common/BaseIcon.vue'

const props = withDefaults(
  defineProps<{
    thread: Conversation
    active?: boolean
    /** 是否禁用（有进行中的会话时禁止切换） */
    disabled?: boolean
    running?: boolean
  }>(),
  { active: false, disabled: false, running: false },
)

const emit = defineEmits<{
  select: [threadId: string]
  rename: [payload: { threadId: string; title: string }]
  export: [threadId: string]
  remove: [threadId: string]
}>()

const displayTitle = computed(() => props.thread.title ?? '新会话')
const formattedTime = computed(() => formatTimestamp(props.thread.updated_at))

function onClick(): void {
  if (props.disabled) {
    return
  }
  emit('select', props.thread.thread_id)
}

const editing = ref(false)
const draftTitle = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

function startEditing(): void {
  if (props.disabled) {
    return
  }
  draftTitle.value = props.thread.title ?? ''
  editing.value = true
  void nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

function commitEditing(): void {
  if (!editing.value) {
    return
  }
  const next = draftTitle.value.trim()
  editing.value = false
  if (next === '' || next === (props.thread.title ?? '')) {
    return
  }
  emit('rename', { threadId: props.thread.thread_id, title: next })
}

function cancelEditing(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
  editing.value = false
}

function onExport(): void {
  if (props.disabled) {
    return
  }
  emit('export', props.thread.thread_id)
}

/** 删除意图：与 select 一样对 `disabled` 兜底（原生 `disabled` 之外再挡一层） */
function onRemove(): void {
  if (props.disabled) {
    return
  }
  emit('remove', props.thread.thread_id)
}
</script>

<template>
  <li class="history-item">
    <input
      v-if="editing"
      ref="inputRef"
      v-model="draftTitle"
      class="history-item__input"
      type="text"
      aria-label="会话标题"
      @keydown.enter.prevent="commitEditing"
      @keydown.esc="cancelEditing"
      @blur="commitEditing"
    />
    <button
      v-else
      type="button"
      class="history-item__button"
      :class="{ 'history-item__button--active': active }"
      :disabled="disabled"
      :aria-current="active ? 'true' : undefined"
      :title="displayTitle"
      @click="onClick"
      @dblclick="startEditing"
    >
      <span class="history-item__line">
        <span v-if="thread.source" class="history-item__source">
          <BaseIcon name="schedule" :size="12" label="定时任务会话" />
        </span>
        <span class="history-item__title">{{ displayTitle }}</span>
      </span>
      <span class="history-item__meta">
        <span v-if="running" class="history-item__running">进行中</span>
        <span class="history-item__time">{{ formattedTime }}</span>
      </span>
    </button>

    <div class="history-item__actions">
      <button
        type="button"
        class="history-item__action history-item__rename"
        :disabled="disabled"
        :aria-label="`重命名会话：${displayTitle}`"
        :title="`重命名会话：${displayTitle}`"
        @click="startEditing"
      >
        <BaseIcon name="edit" :size="14" />
      </button>

      <button
        type="button"
        class="history-item__action history-item__export"
        :disabled="disabled"
        :aria-label="`导出会话：${displayTitle}`"
        :title="`导出为 Markdown：${displayTitle}`"
        @click="onExport"
      >
        <BaseIcon name="download" :size="14" />
      </button>

      <button
        type="button"
        class="history-item__action history-item__remove"
        :disabled="disabled"
        :aria-label="`删除会话：${displayTitle}`"
        :title="`删除会话：${displayTitle}`"
        @click="onRemove"
      >
        <BaseIcon name="trash" :size="14" />
      </button>
    </div>
  </li>
</template>

<style scoped>
.history-item {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.history-item__button {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.history-item__input {
  flex: 1;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
}

.history-item__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-1);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.history-item:hover .history-item__actions,
.history-item:focus-within .history-item__actions {
  opacity: 1;
}

.history-item__action {
  display: inline-flex;
  flex: none;
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.history-item__action:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.history-item__remove:hover:not(:disabled) {
  background: var(--color-status-error-bg);
  color: var(--color-status-error);
}

.history-item__action:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.history-item__button:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.history-item__button--active {
  background: var(--color-primary-subtle);
  color: var(--color-primary);
}

.history-item__button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.history-item__line {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.history-item__source {
  display: inline-flex;
  flex: none;
  color: var(--color-primary);
}

.history-item__title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--font-size-sm);
}

.history-item__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.history-item__running {
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--color-primary-subtle);
  color: var(--color-primary);
}
</style>
