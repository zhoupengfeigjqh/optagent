<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { McpToolInfo } from '../../api/types'

const props = defineProps<{
  modelValue: Record<string, string>
  tools: McpToolInfo[]
  allowedTools: string[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, string>): void
}>()

interface RuleRow {
  tool: string
  field: string
}

interface SchemaNode {
  type?: string
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
}

/** 递归深度上限：真实入参 2–3 层足够，防病态 schema 造成极深枚举 */
const MAX_DEPTH = 5

function rulesFieldPathsOf(toolName: string): string[] {
  const tool = props.tools.find((t) => t.name === toolName)
  return collectPaths((tool?.parameters as SchemaNode | undefined)?.properties, '', 0)
}

function collectPaths(
  properties: Record<string, SchemaNode> | undefined,
  prefix: string,
  depth: number,
): string[] {
  if (!properties || typeof properties !== 'object' || depth > MAX_DEPTH) return []
  const out: string[] = []
  for (const [key, node] of Object.entries(properties)) {
    if (!node || typeof node !== 'object') continue
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (node.type === 'array' || node.items !== undefined) {
      out.push(path)
      continue
    }
    if (node.properties !== undefined) out.push(...collectPaths(node.properties, path, depth + 1))
  }
  return out
}

/**
 * 下拉选项 = Schema 枚举的 array 字段 + 存量值保留项。
 * 只能下拉选择（不许手填），因此已保存但当前枚举不到的值必须作为额外选项保留，
 * 否则 schema 漂移/服务改版后存量配置会被静默丢掉。
 */
function fieldOptions(toolName: string, current: string): string[] {
  const enumerated = rulesFieldPathsOf(toolName)
  if (current !== '' && !enumerated.includes(current)) return [...enumerated, current]
  return enumerated
}


function rulesFieldsToRows(map: Record<string, string>): RuleRow[] {
  return Object.entries(map).map(([tool, field]) => ({ tool, field }))
}

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


const rows = ref<RuleRow[]>([])

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

function isOrphan(tool: string): boolean {
  return tool !== '' && !props.tools.some((t) => t.name === tool)
}

function isFieldOrphan(row: RuleRow): boolean {
  return row.field !== '' && row.tool !== '' && !rulesFieldPathsOf(row.tool).includes(row.field)
}
</script>

<template>
  <fieldset class="rules-field-table">
    <legend class="field__label">算法规则参数设置</legend>
    <p class="field__hint">
      此条仅针对调度算法有效。声明需承载算法规则清单的工具参数：用户在 HITL 参数确认窗中可点
      「从算法规则选择」，从「数据准备/算法规则」的最新规则文件勾选规则并调整优先级， 确认后生成
      array[object] 填入该字段。只对该工具自身开启「调用人工确认」时生效；
      无需确认时参数由模型直接填写，本设置不生效。
    </p>

    <table v-if="rows.length > 0" class="rules-field-table__grid">
      <thead>
        <tr>
          <th>工具</th>
          <th>规则参数字段（array 入参或对象路径）</th>
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
              <option
                v-for="field in fieldOptions(row.tool, row.field)"
                :key="field"
                :value="field"
              >
                {{ field
                }}<template v-if="isFieldOrphan(row) && field === row.field">（清单外）</template>
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
      当前未声明任何算法规则参数{{
        disabled === true ? '（HITL 无需确认或未开启时不可配置）' : '。'
      }}
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
