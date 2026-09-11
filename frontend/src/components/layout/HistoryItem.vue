<script setup lang="ts">
/**
 * 历史会话项（T060）
 *
 * - `title === null` → 展示"新会话"（FR-044 的兜底展示）
 * - 超长标题单行省略，完整标题经 `title` 属性可达
 * - `disabled` 时按钮原生禁用：不可聚焦、不派发 `select`，但文本仍可被读屏读取（FR-036）
 * - `running` 为显式属性：列表接口不返回 `running`（仅详情返回），
 *   故由 `HistorySidebar` 依"存在进行中会话 + 该项为活跃项"派生后传入（契约超集）
 * - 右侧提供「删除」入口（默认淡出，悬停 / 聚焦时显形；`opacity` 不影响可聚焦性，
 *   键盘用户仍可通过 Tab 到达）：本组件只上报 `remove`，**二次确认**与删除后的
 *   "切换到相邻会话或空态"由 `App.vue` 编排（`backend-api.md` §3.5）
 */
import { computed } from 'vue'

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
    <button
      type="button"
      class="history-item__button"
      :class="{ 'history-item__button--active': active }"
      :disabled="disabled"
      :aria-current="active ? 'true' : undefined"
      :title="displayTitle"
      @click="onClick"
    >
      <span class="history-item__title">{{ displayTitle }}</span>
      <span class="history-item__meta">
        <span v-if="running" class="history-item__running">进行中</span>
        <span class="history-item__time">{{ formattedTime }}</span>
      </span>
    </button>

    <button
      type="button"
      class="history-item__remove"
      :disabled="disabled"
      :aria-label="`删除会话：${displayTitle}`"
      :title="`删除会话：${displayTitle}`"
      @click="onRemove"
    >
      <BaseIcon name="trash" :size="14" />
    </button>
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

.history-item__remove {
  display: inline-flex;
  flex: none;
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  /* 默认淡出、悬停或聚焦时显形；`opacity` 不影响可聚焦与可点击 */
  opacity: 0;
  transition: opacity 0.15s ease;
}

.history-item:hover .history-item__remove,
.history-item__remove:focus-visible {
  opacity: 1;
}

.history-item__remove:hover:not(:disabled) {
  background: var(--color-status-error-bg);
  color: var(--color-status-error);
}

.history-item__remove:disabled {
  cursor: not-allowed;
  opacity: 0;
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
