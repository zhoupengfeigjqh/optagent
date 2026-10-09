<script setup lang="ts">
/**
 * 产出正文的**只读结构化视图**（按值递归，2026-09-26）。
 *
 * 规则与 HITL 表单（`InteractionField`）**对齐**，但判据从 schema 换成**值本身**：
 * 产出正文只有数据、没有 schema，也不需要编辑。故本组件**不注入任何表单上下文**，
 * 只吃一个值——这也是它不能直接复用 `InteractionField` 的原因。
 *
 * 分派（与 HITL 同构）：
 * - 对象 → 逐行 `key: value`（递归，嵌套缩进）
 * - 对象数组 → **表格**（列 = 各元素键的并集）；**行与列都有上限**（`PRODUCED_ARRAY_MAX_ITEMS`
 *   / `PRODUCED_TABLE_MAX_COLUMNS`），超出只提示总数。弹窗宽度是自适应的，故横向溢出
 *   **由表格容器自己滚动**（`max-content` 表宽 + `overflow-x`），不把弹窗撑宽。
 * - 其他数组 → **列表**（一行一项）
 * - 超过深度上限 → **JSON 逃生舱**（`<pre>`）
 *
 * `compact`（表格单元格用）：**非标量直接以 JSON 文本呈现、不再递归**——与
 * `InteractionControl` 的 compact 同口径（那里是非标量强制 JSON 文本框）。
 * 否则一格会再长出一棵树，列宽被撑爆。
 *
 * 安全：全部走**文本插值**，`v-html` 一律不用（正文可能含 HTML/脚本）。
 */
import { computed } from 'vue'

import { isPlainObject } from '../../utils/arg-schema'
import {
  PRODUCED_ARRAY_MAX_ITEMS,
  PRODUCED_JSON_MAX_DEPTH,
  PRODUCED_TABLE_MAX_COLUMNS,
  columnsOfRows,
} from '../../utils/produced-content'

const props = withDefaults(
  defineProps<{
    /** 已解析的值（对象 / 数组 / 标量） */
    value: unknown
    /** 当前深度（递归自增；达到上限交 JSON 逃生舱） */
    depth?: number
    /** 紧凑模式：非标量以 JSON 文本呈现（表格单元格用） */
    compact?: boolean
  }>(),
  { depth: 0, compact: false },
)

const isScalar = computed(() => !isPlainObject(props.value) && !Array.isArray(props.value))

/** 紧凑模式下非标量直接转 JSON 文本（不递归）；与"深度超限"共用逃生舱渲染 */
const asRawJson = computed(() => (props.compact && !isScalar.value) || props.depth >= PRODUCED_JSON_MAX_DEPTH)

const isObject = computed(() => isPlainObject(props.value))
const objectEntries = computed(() =>
  isObject.value ? Object.entries(props.value as Record<string, unknown>) : [],
)

const isArray = computed(() => Array.isArray(props.value))
const arrayItems = computed(() => (isArray.value ? (props.value as unknown[]) : []))
const shownItems = computed(() => arrayItems.value.slice(0, PRODUCED_ARRAY_MAX_ITEMS))
const truncatedCount = computed(() => Math.max(0, arrayItems.value.length - shownItems.value.length))

/** 空容器（`{}` / `[]`）单独呈现，避免渲染出没有内容的分组 */
const isEmptyContainer = computed(
  () =>
    (isObject.value && objectEntries.value.length === 0) ||
    (isArray.value && arrayItems.value.length === 0),
)
const emptyLabel = computed(() => (isArray.value ? '[]' : '{}'))

/** 数组按**表格**渲染的判据：非空且元素**全**是对象 */
const asTable = computed(
  () =>
    isArray.value &&
    arrayItems.value.length > 0 &&
    arrayItems.value.every((item) => isPlainObject(item)),
)
/** 表头列（各元素键的并集，取自**全体**行，不随行的截断而变） */
const allColumns = computed(() => (asTable.value ? columnsOfRows(arrayItems.value) : []))
const columns = computed(() => allColumns.value.slice(0, PRODUCED_TABLE_MAX_COLUMNS))
const hiddenColumnCount = computed(() =>
  Math.max(0, allColumns.value.length - columns.value.length),
)

function cellOf(row: unknown, column: string): unknown {
  return isPlainObject(row) ? row[column] : undefined
}

/** 标量的可读文本；`null`/`undefined` 给占位而不是留白 */
function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined
}

/** JSON 逃生舱文本（`JSON.stringify` 对循环引用会抛，故兜底） */
function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}
</script>

<template>
  <!-- 每层都有同一个根钩子（`.produced-json`），便于样式与测试统一选取 -->
  <div class="produced-json">
    <!-- 紧凑模式（表格单元格）或深度超限：交给 JSON 逃生舱，不再递归 -->
    <pre v-if="asRawJson" class="produced-json__raw">{{ jsonText(value) }}</pre>

    <span
      v-else-if="isScalar"
      class="produced-json__scalar"
      :class="{ 'produced-json__scalar--empty': isNullish(value) }"
    >
      {{ scalarText(value) }}
    </span>

    <span v-else-if="isEmptyContainer" class="produced-json__scalar produced-json__scalar--empty">
      {{ emptyLabel }}
    </span>

    <!-- 对象 → 逐行 key/value -->
    <dl v-else-if="isObject" class="produced-json__object">
      <template v-for="entry in objectEntries" :key="entry[0]">
        <dt class="produced-json__key">{{ entry[0] }}</dt>
        <dd class="produced-json__value">
          <ProducedJsonView :value="entry[1]" :depth="depth + 1" />
        </dd>
      </template>
    </dl>

    <!-- 对象数组 → 表格 -->
    <template v-else-if="asTable">
      <div class="produced-json__table-wrap">
        <table class="produced-json__table">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column">{{ column }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in shownItems" :key="index">
              <td v-for="column in columns" :key="column">
                <ProducedJsonView :value="cellOf(row, column)" :depth="depth + 1" compact />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="hiddenColumnCount > 0" class="produced-json__truncated">
        仅显示前 {{ columns.length }} 列，共 {{ allColumns.length }} 列，完整明细请点上方「按原始 JSON 查看」
      </p>
      <p v-if="truncatedCount > 0" class="produced-json__truncated">
        仅显示前 {{ shownItems.length }} 行，共 {{ arrayItems.length }} 行，完整明细请点上方「按原始 JSON 查看」
      </p>
    </template>

    <!-- 其他数组 → 列表 -->
    <template v-else-if="isArray">
      <ol class="produced-json__list">
        <li v-for="(item, index) in shownItems" :key="index" class="produced-json__list-item">
          <ProducedJsonView :value="item" :depth="depth + 1" />
        </li>
      </ol>
      <p v-if="truncatedCount > 0" class="produced-json__truncated">
        仅显示前 {{ shownItems.length }} 行，共 {{ arrayItems.length }} 行，完整明细请点上方「按原始 JSON 查看」
      </p>
    </template>
  </div>
</template>

<style scoped>
.produced-json {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.produced-json__scalar {
  word-break: break-word;
}

.produced-json__scalar--empty {
  color: var(--color-text-muted);
}

/* 对象：键值两列（键不被值挤压，长值换行） */
.produced-json__object {
  display: grid;
  grid-template-columns: minmax(6em, max-content) 1fr;
  gap: 2px var(--space-2);
  margin: 0;
  padding-left: var(--space-3);
  border-left: 2px solid var(--color-border);
}

.produced-json__key {
  font-weight: 600;
  word-break: break-word;
}

.produced-json__value {
  margin: 0;
  min-width: 0;
}

.produced-json__raw {
  margin: 0;
  padding: var(--space-1) var(--space-2);
  overflow: auto;
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  font-family: inherit;
  font-size: var(--font-size-sm);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 表格容器：滚动发生在这里。`max-width: 100%` + 表宽 `max-content` 是关键——
   若表宽仍是 `100%`，列多时只会把每列压扁换行，横向滚动永远不会触发。 */
.produced-json__table-wrap {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.produced-json__table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.produced-json__table th,
.produced-json__table td {
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  vertical-align: top;
}

/* 单元格内容有上界：单格不因一长串 JSON 无限变宽，超长换行（不参与横向滚动） */
.produced-json__table td {
  max-width: 24em;
  word-break: break-word;
}

.produced-json__table tbody tr:last-child td {
  border-bottom: none;
}

.produced-json__table th {
  background: var(--color-bg-subtle);
  font-weight: 600;
  white-space: nowrap;
}

.produced-json__list {
  margin: 0;
  padding-left: var(--space-4);
}

.produced-json__list-item {
  word-break: break-word;
}

.produced-json__truncated {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>
