<script setup lang="ts">
/**
 * 卡片列表（`FR-006`、`SC-022`、`SC-023`）。
 *
 * - **每页固定 8 项（4 列 × 2 行）**：`page_size` 由服务端固定，组件只做呈现，
 *   MUST NOT 接受客户端覆盖；
 * - 展示**总条数与页码**，翻页 ≤ 100ms（纯前端切片，无请求）；
 * - 加载中 / 失败 / 空 三态**可区分**，失败给出可读原因。
 */
import { computed } from 'vue'
import type { ErrorInfo } from '../../api/types'
import EmptyState from './EmptyState.vue'
import ErrorNotice from './ErrorNotice.vue'

const props = withDefaults(
  defineProps<{
    title: string
    items: readonly unknown[]
    total: number
    page: number
    /** 服务端固定值；仅用于呈现与页数计算 */
    pageSize?: number
    loading?: boolean
    error?: ErrorInfo | null
    emptyTitle?: string
    emptyDescription?: string
    /** 稳定 key；缺省按索引 */
    itemKey?: (item: unknown, index: number) => string
  }>(),
  {
    pageSize: 8,
    loading: false,
    error: null,
    emptyTitle: '暂无数据',
    emptyDescription: '',
    itemKey: undefined,
  },
)

const emit = defineEmits<{
  (e: 'update:page', value: number): void
}>()

const totalPages = computed(() =>
  props.total <= 0 ? 0 : Math.ceil(props.total / Math.max(1, props.pageSize)),
)
const canPrev = computed(() => props.page > 1)
const canNext = computed(() => props.page < totalPages.value)

function keyOf(item: unknown, index: number): string {
  return props.itemKey ? props.itemKey(item, index) : String(index)
}

function go(target: number): void {
  if (target < 1 || target > Math.max(1, totalPages.value)) return
  emit('update:page', target)
}
</script>

<template>
  <section class="card-list" :aria-label="title">
    <header class="card-list__header">
      <h2 class="card-list__title">{{ title }}</h2>
      <p class="card-list__summary" aria-live="polite">
        共 {{ total }} 项<template v-if="totalPages > 0">，第 {{ page }} / {{ totalPages }} 页</template>
      </p>
    </header>

    <p v-if="loading" class="card-list__loading" role="status">加载中…</p>

    <ErrorNotice v-else-if="error" :error="error" :title="`${title}加载失败`" />

    <EmptyState
      v-else-if="items.length === 0"
      :title="emptyTitle"
      :description="emptyDescription"
    >
      <slot name="empty" />
    </EmptyState>

    <ul v-else class="card-list__grid">
      <li v-for="(item, index) in items" :key="keyOf(item, index)" class="card-list__cell">
        <slot name="item" :item="item" :index="index" />
      </li>
    </ul>

    <nav v-if="totalPages > 1" class="card-list__pager" :aria-label="`${title}分页`">
      <button
        type="button"
        class="btn"
        :disabled="!canPrev"
        :aria-label="`上一页（当前第 ${page} 页）`"
        @click="go(page - 1)"
      >
        上一页
      </button>
      <span class="card-list__page-indicator" aria-live="polite">第 {{ page }} / {{ totalPages }} 页</span>
      <button
        type="button"
        class="btn"
        :disabled="!canNext"
        :aria-label="`下一页（当前第 ${page} 页）`"
        @click="go(page + 1)"
      >
        下一页
      </button>
    </nav>
  </section>
</template>

<style scoped>
.card-list__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.card-list__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.card-list__summary {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.card-list__loading {
  padding: var(--space-5);
  text-align: center;
  color: var(--color-text-secondary);
}

/* 4 列 × 2 行 = 每页恒 8 项（SC-023） */
.card-list__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (max-width: 1100px) {
  .card-list__grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .card-list__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .card-list__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.card-list__cell {
  min-width: 0;
}

.card-list__pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin-top: var(--space-5);
}

.card-list__page-indicator {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}
</style>
