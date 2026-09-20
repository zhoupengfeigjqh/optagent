<script setup lang="ts">
/**
 * 算法规则参数设置表格（`rules_fields` 的编辑视图，2026-09-19）。
 *
 * 存储契约：对外是 `{ 工具名: 字段名 }`（最终写入 `MCP.json` 的 `rules_fields`），
 * 每工具至多一条——声明该工具入参里承载 `array[object]` 规则清单的字段。
 *
 * 交互：
 * - 「工具」下拉选项由父级按 HITL 确认范围过滤后传入（`allowedTools`）：
 *   无需确认时父级禁用整个表格并清空；仅指定工具时只列勾选的工具；全部确认时列全部；
 * - 「字段」下拉 = 该工具参数 JSON Schema 里 `type: "array"` 的入参（规则选择器的
 *   产物是 array[object]）；已保存但当前 Schema 中不存在的值作为「清单外」保留项出现，
 *   不静默丢弃；
 * - `disabled`（HITL = 无需确认，或服务工具清单不可得）时整表禁用、不可增删行。
 */
import { computed, ref, watch } from 'vue'
import type { McpToolInfo } from '../../api/types'

const props = defineProps<{
  modelValue: Record<string, string>
  tools: McpToolInfo[]
  /** 当前 HITL 确认范围内可选的工具（父级已按确认模式过滤） */
  allowedTools: string[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, string>): void
}>()

/** 一行 = 一条 工具-字段 声明 */
interface RuleRow {
  tool: string
  field: string
}

interface SchemaNode {
  type?: string
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
}

/** 该工具入参里的 array 字段名（规则选择器产物是 array[object]，只列 array 入参） */
function arrayFieldsOf(toolName: string): string[] {
  const tool = props.tools.find((t) => t.name === toolName)
  const properties = (tool?.parameters as SchemaNode | undefined)?.properties
  if (!properties || typeof properties !== 'object') return []
  return Object.entries(properties)
    .filter(([, node]) => node?.type === 'array' || node?.items !== undefined)
    .map(([key]) => key)
}

/**
 * 下拉选项 = Schema 枚举的 array 字段 + 存量值保留项。
 * 只能下拉选择（不许手填），因此已保存但当前枚举不到的值必须作为额外选项保留，
 * 否则 schema 漂移/服务改版后存量配置会被静默丢掉。
 */
function fieldOptions(toolName: string, current: string): string[] {
  const enumerated = arrayFieldsOf(toolName)
  if (current !== '' && !enumerated.includes(current)) return [...enumerated, current]
  return enumerated
}

/* ---------- 行模型 ↔ rules_fields 互转 ---------- */

function rulesFieldsToRows(map: Record<string, string>): RuleRow[] {
  return Object.entries(map).map(([tool, field]) => ({ tool, field }))
}

/** 该行是否通过判据（不通过的不写入序列化结果） */
function rowValid(row: RuleRow): boolean {
  return row.tool.trim() !== '' && row.field.trim() !== ''
}

function rowsToRulesFields(list: RuleRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of list) {
    if (!rowValid(row)) continue
    out[row.tool.trim()] = row.field.trim()
  }
  return out
}

/* ---------- 编辑状态 ---------- */

const rows = ref<RuleRow[]>([])

/**
 * 自己 emit 的**回声不重建**编辑态（与 FileArgsMappingTable 同一模式）：
 * 只有外部真正换数据（切换服务、HITL 范围变化导致父级清空）才重建。
 */
const lastEmitted = ref<string | null>(null)

watch(
  () => props.modelValue,
  (next) => {
    if (JSON.stringify(next) === lastEmitted.value) return
    rows.value = rulesFieldsToRows(next)
  },
  { immediate: true, deep: true },
)

function commit(): void {
  const value = rowsToRulesFields(rows.value)
  lastEmitted.value = JSON.stringify(value)
  emit('update:modelValue', value)
}

function setRow(index: number, key: 'tool' | 'field', value: string): void {
  const row = rows.value[index]!
  row[key] = value
  // 换工具后原字段大概率不属于新工具的 schema：清空，避免"张冠李戴"的脏组合入库
  if (key === 'tool') row.field = ''
  commit()
}

function removeRow(index: number): void {
  rows.value.splice(index, 1)
  commit()
}

function addRow(): void {
  rows.value.push({ tool: '', field: '' })
}

/** 同一工具声明多行的冲突提示（序列化时后写覆盖先写，必须拦在界面上） */
const duplicateError = computed(() => {
  const seen = new Set<string>()
  for (const row of rows.value) {
    if (row.tool.trim() === '') continue
    if (seen.has(row.tool)) return `工具「${row.tool}」重复声明：一个工具只需一行`
    seen.add(row.tool)
  }
  return ''
})

/** 清单外工具（服务改版/清单截断）：保留行、标徽提示，不静默丢弃 */
function isOrphan(tool: string): boolean {
  return tool !== '' && !props.tools.some((t) => t.name === tool)
}

/** 字段保留项：已保存值不在当前 Schema 枚举里（schema 漂移），标徽提示 */
function isFieldOrphan(row: RuleRow): boolean {
  return (
    row.field !== '' &&
    row.tool !== '' &&
    !arrayFieldsOf(row.tool).includes(row.field)
  )
}
</script>

<template>
  <fieldset class="rules-field-table">
    <legend class="field__label">算法规则参数设置</legend>
    <p class="field__hint">
      声明哪些工具的 array 入参承载算法规则清单：用户在 HITL 参数确认窗中可点
      「从算法规则选择」，从「数据准备/算法规则」的最新规则文件勾选规则并调整优先级，
      确认后生成 array[object] 填入该字段。只对该工具自身开启「调用人工确认」时生效；
      无需确认时参数由模型直接填写，本设置不生效。
    </p>

    <table v-if="rows.length > 0" class="rules-field-table__grid">
      <thead>
        <tr>
          <th>工具</th>
          <th>规则参数字段（array 入参）</th>
          <th aria-label="操作" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="`${row.tool}-${index}`">
          <td>
            <select
              :value="row.tool"
              :disabled="disabled === true"
              :data-test="`rule-tool-${index}`"
              @change="setRow(index, 'tool', ($event.target as HTMLSelectElement).value)"
            >
              <option value="" disabled>（选工具）</option>
              <option v-for="name in allowedTools" :key="name" :value="name">{{ name }}</option>
              <option v-if="isOrphan(row.tool)" :value="row.tool">{{ row.tool }}（清单外）</option>
            </select>
          </td>
          <td>
            <select
              :value="row.field"
              :disabled="disabled === true"
              :class="{ invalid: row.field === '' }"
              :data-test="`rule-field-${index}`"
              @change="setRow(index, 'field', ($event.target as HTMLSelectElement).value)"
            >
              <option value="" disabled>（选字段）</option>
              <option v-for="field in fieldOptions(row.tool, row.field)" :key="field" :value="field">
                {{ field }}<template v-if="isFieldOrphan(row) && field === row.field">（清单外）</template>
              </option>
            </select>
            <div v-if="row.field === ''" class="rules-field-table__error" role="alert">
              请选择规则参数字段
            </div>
            <div v-else-if="isFieldOrphan(row)" class="rules-field-table__error" role="alert">
              该字段不在当前 Schema 的 array 入参里（服务可能已改版），保存前请确认
            </div>
          </td>
          <td>
            <button
              type="button"
              class="btn btn--sm"
              :disabled="disabled === true"
              :aria-label="`删除声明 ${row.tool}`"
              :data-test="`rule-remove-${index}`"
              @click="removeRow(index)"
            >
              ✕
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="field__hint">
      当前未声明任何算法规则参数{{ disabled === true ? '（HITL 无需确认或未开启时不可配置）' : '。' }}
    </p>

    <p v-if="duplicateError !== ''" class="rules-field-table__error" role="alert">
      {{ duplicateError }}
    </p>

    <div class="rules-field-table__add">
      <button
        type="button"
        class="btn"
        data-test="add-rule"
        :disabled="disabled === true || allowedTools.length === 0"
        @click="addRow"
      >
        + 添加声明
      </button>
    </div>
  </fieldset>
</template>

<style scoped>
.rules-field-table {
  margin: 0 0 var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.rules-field-table__grid {
  width: 100%;
  border-collapse: collapse;
  margin-top: var(--space-2);
}

.rules-field-table__grid th,
.rules-field-table__grid td {
  text-align: left;
  padding: var(--space-1) var(--space-2) var(--space-1) 0;
  vertical-align: top;
  font-size: var(--font-size-sm);
}

.rules-field-table__grid th {
  color: var(--color-text-muted);
  font-weight: 600;
  font-size: var(--font-size-xs);
}

.rules-field-table__error {
  color: var(--color-status-error);
  font-size: var(--font-size-xs);
  margin-top: 2px;
}

.rules-field-table__add {
  margin-top: var(--space-2);
}

select.invalid {
  border-color: var(--color-status-error);
}
</style>
