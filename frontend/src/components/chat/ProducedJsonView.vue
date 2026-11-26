<script setup lang="ts">
import { computed } from 'vue'

import { isPlainObject } from '../../utils/arg-schema'
import {
  isViewUrlField,
  resolveViewUrl,
  toViewLinkTarget,
  type ViewLinkTarget,
} from '../../utils/view-link'
import {
  PRODUCED_ARRAY_MAX_ITEMS,
  PRODUCED_JSON_MAX_DEPTH,
  PRODUCED_TABLE_MAX_COLUMNS,
  columnsOfRows,
} from '../../utils/produced-content'

const props = withDefaults(
  defineProps<{
    value: unknown
    /** 当前深度（递归自增；达到上限交 JSON 逃生舱） */
    depth?: number
    compact?: boolean
    /**
     * 该值所属的**字段名**（对象行 = 键；表格单元格 = 列名）。
     *
     * 视图链接只按字段名判定（`TR-40`）：值像不像 URL 一律不看——否则正文里任何
     * 形如 `/api/…` 的普通字段都会被链接化，那是误报而非功能。
     */
    fieldKey?: string
  }>(),
  { depth: 0, compact: false, fieldKey: undefined },
)

const emit = defineEmits<{
  'open-view': [item: ViewLinkTarget]
}>()

const isScalar = computed(() => !isPlainObject(props.value) && !Array.isArray(props.value))

const linkHref = computed(() =>
  isViewUrlField(props.fieldKey) ? resolveViewUrl(props.value) : null,
)

function onLinkClick(event: MouseEvent): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const href = linkHref.value
  if (href === null) return
  event.preventDefault()
  emit('open-view', toViewLinkTarget({ href, raw: String(props.value), kind: 'url' }))
}

const asRawJson = computed(
  () => (props.compact && !isScalar.value) || props.depth >= PRODUCED_JSON_MAX_DEPTH,
)

const isObject = computed(() => isPlainObject(props.value))
const objectEntries = computed(() =>
  isObject.value ? Object.entries(props.value as Record<string, unknown>) : [],
)

const isArray = computed(() => Array.isArray(props.value))
const arrayItems = computed(() => (isArray.value ? (props.value as unknown[]) : []))
const shownItems = computed(() => arrayItems.value.slice(0, PRODUCED_ARRAY_MAX_ITEMS))
const truncatedCount = computed(() =>
  Math.max(0, arrayItems.value.length - shownItems.value.length),
)

/** 空容器（`{}` / `[]`）单独呈现，避免渲染出没有内容的分组 */
const isEmptyContainer = computed(
  () =>
    (isObject.value && objectEntries.value.length === 0) ||
    (isArray.value && arrayItems.value.length === 0),
)
const emptyLabel = computed(() => (isArray.value ? '[]' : '{}'))

const asTable = computed(
  () =>
    isArray.value &&
    arrayItems.value.length > 0 &&
    arrayItems.value.every((item) => isPlainObject(item)),
)
const allColumns = computed(() => (asTable.value ? columnsOfRows(arrayItems.value) : []))
const columns = computed(() => allColumns.value.slice(0, PRODUCED_TABLE_MAX_COLUMNS))
const hiddenColumnCount = computed(() =>
  Math.max(0, allColumns.value.length - columns.value.length),
)

function cellOf(row: unknown, column: string): unknown {
  return isPlainObject(row) ? row[column] : undefined
}

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
  <div class="produced-json">
    <pre v-if="asRawJson" class="produced-json__raw">{{ jsonText(value) }}</pre>

    <a
      v-else-if="linkHref !== null"
      class="produced-json__link"
      :href="linkHref"
      target="_blank"
      rel="noopener noreferrer"
      @click="onLinkClick"
      >{{ scalarText(value) }}</a
    >

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

    <dl v-else-if="isObject" class="produced-json__object">
      <template v-for="entry in objectEntries" :key="entry[0]">
        <dt class="produced-json__key">{{ entry[0] }}</dt>
        <dd class="produced-json__value">
          <ProducedJsonView
            :value="entry[1]"
            :depth="depth + 1"
            :field-key="entry[0]"
            @open-view="emit('open-view', $event)"
          />
        </dd>
      </template>
    </dl>

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
                <ProducedJsonView
                  :value="cellOf(row, column)"
                  :depth="depth + 1"
                  :field-key="column"
                  compact
                  @open-view="emit('open-view', $event)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="hiddenColumnCount > 0" class="produced-json__truncated">
        仅显示前 {{ columns.length }} 列，共 {{ allColumns.length }} 列，完整明细请点上方「按原始
        JSON 查看」
      </p>
      <p v-if="truncatedCount > 0" class="produced-json__truncated">
        仅显示前 {{ shownItems.length }} 行，共 {{ arrayItems.length }} 行，完整明细请点上方「按原始
        JSON 查看」
      </p>
    </template>

    <template v-else-if="isArray">
      <ol class="produced-json__list">
        <li v-for="(item, index) in shownItems" :key="index" class="produced-json__list-item">
          <ProducedJsonView
            :value="item"
            :depth="depth + 1"
            @open-view="emit('open-view', $event)"
          />
        </li>
      </ol>
      <p v-if="truncatedCount > 0" class="produced-json__truncated">
        仅显示前 {{ shownItems.length }} 行，共 {{ arrayItems.length }} 行，完整明细请点上方「按原始
        JSON 查看」
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

/* 视图链接：沿用全局链接色（`tokens.css --color-primary`）+ 下划线。
   下划线不是装饰——可点性 MUST NOT 只靠颜色传达（宪章原则四）。 */
.produced-json__link {
  color: var(--color-primary);
  text-decoration: underline;
  word-break: break-all;
}

.produced-json__scalar--empty {
  color: var(--color-text-muted);
}

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
