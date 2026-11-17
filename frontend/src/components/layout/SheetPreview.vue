<script setup lang="ts">
/**
 * `.xlsx` 表格预览（2026-11-17，档 A）。
 *
 * **只做渲染**：数据由 `GET /api/files/preview` 给全（`rows` 显示文本、`numericCols`
 * 数字列、`merges` 合并区间），本组件不解析 CSV、不判断数字列——两套口径会让
 * "服务端说这列是数字、前端说是文本"这类偏差无处对账。
 *
 * 三个刻意的取舍：
 * 1. **第一行当表头**：业务表格几乎都有表头，而表头吸顶是"看得清"的主要收益。
 *    组件不做"这行像不像表头"的猜测——猜错比固定更糟。
 * 2. **原生 `<table>`，不用 `a-table`**：合并单元格、首列吸顶、行高压缩这几件事
 *    在 a-table 里都要绕过它自己的 tr/td 生成逻辑，收益为负。
 * 3. **有渲染上限**（`RENDER_MAX_ROWS` / `RENDER_MAX_COLS`）：原生表格没有虚拟滚动，
 *    400 行 × 60 列 ≈ 2.4 万个单元格是"扫一眼"场景的上限；超出的部分提示下载。
 *    服务端另有 `SHEET_MAX_ROWS` 的传输上限，两层各管一件事。
 */
import { computed, ref, watch } from 'vue'

import type { PreviewWorkbook } from '../../api/types'

const props = defineProps<{
  /** 服务端解析好的工作簿；`null` 表示还没加载 */
  workbook: PreviewWorkbook | null
}>()

/** 前端渲染行上限（超出的行不进 DOM） */
const RENDER_MAX_ROWS = 400

/** 前端渲染列上限 */
const RENDER_MAX_COLS = 60

const activeIndex = ref(0)
const sheets = computed(() => props.workbook?.sheets ?? [])
const active = computed(() => sheets.value[activeIndex.value] ?? null)

// 换文件 / 文件重新加载：回到第一个 sheet，避免停在一个不存在的位置
watch(
  () => props.workbook,
  () => {
    activeIndex.value = 0
  },
)

/** 当前 sheet 的全部行（含表头行） */
const rows = computed(() => active.value?.rows ?? [])

/** 有效列数：取所有行的最大长度（表头行可能短于数据行） */
const totalCols = computed(() => {
  let max = 0
  for (const row of rows.value) {
    max = Math.max(max, row.length)
  }
  return max
})

/** 实际渲染的列数（受上限约束） */
const colCount = computed<number[]>(() =>
  Array.from({ length: Math.min(totalCols.value, RENDER_MAX_COLS) }, (_, index) => index),
)

/** 实际渲染的数据行下标（0 基，跳过第 0 行表头） */
const bodyRowIndexes = computed<number[]>(() => {
  const count = Math.min(Math.max(rows.value.length - 1, 0), RENDER_MAX_ROWS)
  return Array.from({ length: count }, (_, index) => index + 1)
})

/** 数字列集合（列下标为 0 基） */
const numericCols = computed<Set<number>>(() => new Set(active.value?.numericCols ?? []))

/**
 * 合并单元格的两张表：
 * - `spans`：起点格 → 跨度（绑定到 `rowspan` / `colspan`）
 * - `covered`：被覆盖的格子 → 不渲染
 *
 * 服务端已把跨越截断边界的合并裁到可见范围，这里不再二次裁剪。
 */
const mergeMaps = computed(() => {
  const spans = new Map<string, { rowSpan: number; colSpan: number }>()
  const covered = new Set<string>()
  for (const merge of active.value?.merges ?? []) {
    spans.set(`${merge.r},${merge.c}`, { rowSpan: merge.rowSpan, colSpan: merge.colSpan })
    for (let r = merge.r; r < merge.r + merge.rowSpan; r += 1) {
      for (let c = merge.c; c < merge.c + merge.colSpan; c += 1) {
        if (r !== merge.r || c !== merge.c) {
          covered.add(`${r},${c}`)
        }
      }
    }
  }
  return { spans, covered }
})

function isNumeric(col: number): boolean {
  return numericCols.value.has(col)
}

function isCovered(row: number, col: number): boolean {
  return mergeMaps.value.covered.has(`${row},${col}`)
}

function spanAt(row: number, col: number): { rowSpan: number; colSpan: number } | undefined {
  return mergeMaps.value.spans.get(`${row},${col}`)
}

function valueAt(row: number, col: number): string {
  return rows.value[row]?.[col] ?? ''
}

/** 表头文本（第 0 行） */
function headerAt(col: number): string {
  return valueAt(0, col)
}

/**
 * 截断提示：服务端截断（`truncated`）与前端渲染截断合并成一句话。
 *
 * 两层的数字不同（服务端 1000 行、前端 400 行），但对用户只有一个事实：
 * "你现在看到的不是全部"。
 */
const truncatedHint = computed(() => {
  if (!active.value) {
    return ''
  }
  const overRows = rows.value.length - 1 > RENDER_MAX_ROWS || active.value.truncated
  const overCols = totalCols.value > RENDER_MAX_COLS
  if (!overRows && !overCols) {
    return ''
  }
  const scopes: string[] = []
  if (overRows) {
    scopes.push(`前 ${RENDER_MAX_ROWS} 行`)
  }
  if (overCols) {
    scopes.push(`前 ${RENDER_MAX_COLS} 列`)
  }
  return `表格较大，当前只显示${scopes.join('、')}，完整内容请下载查看。`
})

const isEmpty = computed(() => rows.value.length === 0)

function select(index: number): void {
  activeIndex.value = index
}

/** ← → 在 sheet 之间切换（tablist 语义：焦点必须跟着走） */
function onTabKeydown(event: KeyboardEvent, index: number): void {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
    return
  }
  event.preventDefault()
  const total = sheets.value.length
  if (total === 0) {
    return
  }
  const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + total) % total
  activeIndex.value = next
  const buttons = (event.currentTarget as HTMLElement)
    .parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  buttons?.[next]?.focus()
}
</script>

<template>
  <div class="sheet-preview">
    <p v-if="sheets.length === 0" class="sheet-preview__empty">该 Excel 文件没有任何工作表</p>

    <template v-else>
      <div class="sheet-preview__tabs" role="tablist" aria-label="工作表">
        <button
          v-for="(sheet, index) in sheets"
          :key="sheet.name"
          type="button"
          role="tab"
          class="sheet-preview__tab"
          :aria-selected="index === activeIndex"
          :tabindex="index === activeIndex ? 0 : -1"
          @click="select(index)"
          @keydown="onTabKeydown($event, index)"
        >
          {{ sheet.name }}
        </button>
      </div>

      <p v-if="isEmpty" class="sheet-preview__empty">该工作表为空</p>

      <div v-else class="sheet-preview__viewport" role="tabpanel">
        <table class="sheet-preview__table" :aria-label="`${active?.name ?? ''} 工作表`">
          <thead>
            <tr>
              <th
                v-for="col in colCount"
                :key="col"
                scope="col"
                class="sheet-preview__cell sheet-preview__head"
                :class="{ 'sheet-preview__cell--num': isNumeric(col) }"
              >
                {{ headerAt(col) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in bodyRowIndexes" :key="row">
              <template v-for="col in colCount" :key="col">
                <td
                  v-if="!isCovered(row, col)"
                  class="sheet-preview__cell"
                  :class="{ 'sheet-preview__cell--num': isNumeric(col) }"
                  :rowspan="spanAt(row, col)?.rowSpan"
                  :colspan="spanAt(row, col)?.colSpan"
                >
                  {{ valueAt(row, col) }}
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="truncatedHint" class="sheet-preview__hint">{{ truncatedHint }}</p>
    </template>
  </div>
</template>

<style scoped>
.sheet-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.sheet-preview__tabs {
  display: flex;
  flex: none;
  gap: 2px;
  padding: 0 var(--space-2);
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border);
}

.sheet-preview__tab {
  position: relative;
  flex: none;
  height: 32px;
  padding: 0 var(--space-3);
  color: var(--color-text-muted);
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  font-size: var(--font-size-sm);
  white-space: nowrap;
  cursor: pointer;
}

.sheet-preview__tab:hover {
  color: var(--color-text);
}

.sheet-preview__tab:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: -2px;
}

.sheet-preview__tab[aria-selected='true'] {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  font-weight: 600;
}

.sheet-preview__viewport {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.sheet-preview__table {
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}

.sheet-preview__cell {
  height: 30px;
  padding: 0 var(--space-3);
  border-right: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
  text-align: left;
  white-space: nowrap;
}

.sheet-preview__cell--num {
  text-align: right;
}

/* 表头吸顶；首列吸顶。两者交叉的左上角要压在其余单元格之上 */
.sheet-preview__head {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font-weight: 600;
}

.sheet-preview__cell:first-child {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--color-surface);
}

.sheet-preview__head:first-child {
  z-index: 3;
  background: var(--color-bg-subtle);
}

.sheet-preview__viewport tbody tr:nth-child(even) .sheet-preview__cell {
  background: var(--color-bg-subtle);
}

.sheet-preview__viewport tbody tr:hover .sheet-preview__cell {
  background: var(--color-primary-subtle);
}

.sheet-preview__empty {
  margin: 0;
  padding: var(--space-5) var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-align: center;
}

.sheet-preview__hint {
  flex: none;
  margin: 0;
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
</style>
