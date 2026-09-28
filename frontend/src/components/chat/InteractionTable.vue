<script setup lang="ts">
/**
 * 对象数组 → **表格**（HITL 递归表单，2026-09-23）。
 *
 * 纯展示 + 一处交互（删行，向上抛事件）：行的增删与单元格取值都由父级 `InteractionField`
 * 经表单状态完成，本组件不持有入参数据——这样"表格长什么样"与"值怎么变"互不纠缠。
 *
 * 列由父级算好传入（schema 声明列 + 值里实际出现的列）；单元格复用 `InteractionControl` 的
 * 紧凑模式，因此单元格里能填什么与字段行里完全一致。
 */
import { isPlainObject } from '../../utils/arg-schema'
import type { FieldSchema } from '../../utils/arg-schema'
import type { NodePath } from '../../utils/json-path'
import InteractionControl from './InteractionControl.vue'

const props = defineProps<{
  /** 表格字段本身的路径（单元格路径 = 本路径 + [行下标, 列名]） */
  path: NodePath
  /** 列名（顺序即表头顺序） */
  columns: string[]
  /** 行（保留原始元素与下标：过滤会让下标错位，写入就会落到别的行） */
  rows: unknown[]
  /** 元素 schema（单元格控件形态的依据；列不在它声明范围内时为空 schema） */
  itemSchema: FieldSchema
  /** 某个列对应的单元格 schema（列未声明 → 空 schema） */
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
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th class="interaction-dialog__row-actions" aria-label="行操作" />
        </tr>
      </thead>
      <tbody>
        <tr v-if="rows.length === 0">
          <td :colspan="columns.length + 1" class="interaction-dialog__table-empty">
            {{ columns.length === 0 ? '无可用的列：可用「从算法规则选择」生成，或切到 JSON 编辑' : '尚未添加任何行。' }}
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
.interaction-dialog__table-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.interaction-dialog__table {
  width: 100%;
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
