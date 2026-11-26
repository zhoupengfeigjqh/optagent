<script setup lang="ts">
import { fieldLabelOf, isPlainObject } from '../../utils/arg-schema'
import type { FieldSchema } from '../../utils/arg-schema'
import type { NodePath } from '../../utils/json-path'
import InteractionControl from './InteractionControl.vue'

const props = defineProps<{
  path: NodePath
  columns: string[]
  rows: unknown[]
  itemSchema: FieldSchema
  cellSchemaOf: (column: string) => FieldSchema
}>()

const emit = defineEmits<{ remove: [index: number] }>()

function rowIndexes(): number[] {
  return props.rows.map((_row, index) => index)
}

function isRowObject(index: number): boolean {
  return isPlainObject(props.rows[index])
}
</script>

<template>
  <div class="interaction-dialog__table-wrap">
    <table class="interaction-dialog__table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">
            {{ fieldLabelOf(column, cellSchemaOf(column)) }}
          </th>
          <th class="interaction-dialog__row-actions" aria-label="行操作" />
        </tr>
      </thead>
      <tbody>
        <tr v-if="rows.length === 0">
          <td :colspan="columns.length + 1" class="interaction-dialog__table-empty">
            {{
              columns.length === 0
                ? '无可用的列：可用「从算法规则选择」生成，或切到 JSON 编辑'
                : '尚未添加任何行。'
            }}
          </td>
        </tr>
        <tr v-for="index in rowIndexes()" :key="index">
          <td
            v-if="!isRowObject(index)"
            :colspan="columns.length + 1"
            class="interaction-dialog__table-empty"
          >
            第 {{ index + 1 }} 行不是对象，无法按表格编辑：请切到 JSON 编辑修正
          </td>
          <template v-else>
            <td v-for="column in columns" :key="column">
              <InteractionControl
                compact
                :schema="cellSchemaOf(column)"
                :path="[...path, index, column]"
                :name="column"
              />
            </td>
            <td class="interaction-dialog__row-actions">
              <button
                type="button"
                class="interaction-dialog__row-remove"
                :aria-label="`删除第 ${index + 1} 行`"
                @click="emit('remove', index)"
              >
                ×
              </button>
            </td>
          </template>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* 横向滚动**真正**发生在这里（2026-10-09）：容器限宽 + 表宽按内容铺开。
   此前表宽是 `100%`，列多时只会把每列压扁换行、把可编辑控件塞进窄格，
   滚动条永远不出现。列多就让它溢出、由本容器滚——**不给列数上限**：
   列是可编辑字段，藏掉列等于那几个字段没法填。 */
.interaction-dialog__table-wrap {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.interaction-dialog__table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.interaction-dialog__table th,
.interaction-dialog__table td {
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--color-border);
  text-align: left;
}

.interaction-dialog__table tbody tr:last-child td {
  border-bottom: none;
}

.interaction-dialog__table th {
  background: var(--color-bg-subtle);
  font-weight: 600;
  white-space: nowrap;
}

.interaction-dialog__row-actions {
  width: 32px;
  text-align: center;
}

.interaction-dialog__row-remove {
  padding: 0 var(--space-1);
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-md);
  line-height: 1;
  cursor: pointer;
}

.interaction-dialog__row-remove:hover {
  color: var(--color-text);
}

.interaction-dialog__table-empty {
  color: var(--color-text-muted);
}
</style>
