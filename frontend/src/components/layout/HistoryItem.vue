<script setup lang="ts">
/**
 * 历史会话项（T060）
 *
 * - `title === null` → 展示"新会话"（FR-044 的兜底展示）
 * - 超长标题单行省略，完整标题经 `title` 属性可达
 * - `disabled` 时按钮原生禁用：不可聚焦、不派发 `select`，但文本仍可被读屏读取（FR-036）
 * - `running` 为显式属性：列表接口不返回 `running`（仅详情返回），
 *   故由 `HistorySidebar` 依"存在进行中会话 + 该项为活跃项"派生后传入（契约超集）
 * - 右侧操作区（悬停 / 聚焦显形）三项：**重命名**、**导出 Markdown**（均 2026-10-16）、删除。
 *   删除只上报 `remove`，二次确认与"切换到相邻会话或空态"由 `views/WorkbenchView.vue` 编排
 *   （`backend-api.md` §3.5）；导出只上报 `export`，拉取与落盘同样由该视图编排。
 * - 重命名是**行内编辑**（双击标题，或点编辑入口）：Enter / 失焦确认、Esc 取消，
 *   空标题与未改动一律不发请求；请求与回滚在 `useThreads.rename`。
 */
import { computed, nextTick, ref } from 'vue'

import type { Conversation } from '../../api/types'
import { formatTimestamp } from '../../utils/format'
import BaseIcon from '../common/BaseIcon.vue'

const props = withDefaults(
  defineProps<{
    /** 会话 */
    thread: Conversation
    /** 是否为当前选中会话 */
    active?: boolean
    /** 是否禁用（有进行中的会话时禁止切换） */
    disabled?: boolean
    /** 该会话本轮是否仍在进行 */
    running?: boolean
  }>(),
  { active: false, disabled: false, running: false },
)

const emit = defineEmits<{
  select: [threadId: string]
  /** 提交新标题（空标题 / 未改动由本组件拦下，不会发出） */
  rename: [payload: { threadId: string; title: string }]
  /** 请求把该会话导出为 Markdown（拉取与落盘由 `WorkbenchView` 编排） */
  export: [threadId: string]
  /** 请求删除该会话（二次确认与真正的删除由上层编排，`backend-api.md` §3.5） */
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

/* ---------- 行内重命名（2026-10-16） ---------- */

const editing = ref(false)
const draftTitle = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

/** 进入编辑态：预填当前标题并全选（连着改几个会话时少按几次键） */
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

/** 确认：空标题或与现值相同 = 就地收手（不发请求、不动数据） */
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

/**
 * 取消（Esc）：只收编辑框。
 *
 * `stopPropagation` 不是洁癖：`ChatPanel` 在 `window` 上挂着"Esc 中断本轮"，
 * 不拦住的话，用户想取消改名会顺手把正在输出的回答掐掉。
 */
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
        <!-- 015：定时任务会话的闪电标记。与「进行中」徽标共存（两个通道互不替代），
             图标带可读名称，读屏会把它念进条目名（"定时任务会话 …"） -->
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

/* 行内编辑框：与外层条目同宽同位，进入编辑时视觉上不跳动 */
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
  /* 默认淡出、悬停或**任意子元素聚焦**时显形；`opacity` 不影响可聚焦与可点击，
     键盘用户 Tab 进来即可见（`focus-within` 比逐个 `:focus-visible` 更不容易漏）。 */
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

/* 图标与标题同一行：按钮是纵向 flex，不包一层会把图标顶成独立一行 */
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
