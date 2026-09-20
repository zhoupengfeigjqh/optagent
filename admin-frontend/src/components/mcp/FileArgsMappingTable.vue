<script setup lang="ts">
/**
 * 文件参数映射表格（`file_args` 的编辑视图，2026-09-19）。
 *
 * 存储契约**不变**：对外仍是 `{ 工具名: { 取值路径: "url" | "url:from=<来源路径>" } }`
 * （最终写入 `MCP.json`），本组件只是把 JSON 文本框换成"选工具、选字段"的行式表格。
 *
 * 交互（2026-09-19 产品决定：**三列全部只能下拉选择，不允许手填**）：
 * - 「工具」下拉 = 服务探测到的工具清单；清单外的存量值（服务改版/截断）作为
 *   额外保留项出现，标「清单外」，可继续保存但不可新增手填；
 * - 「目标字段 / 来源字段」下拉 = 该工具参数 JSON Schema 递归枚举的叶子路径
 *   （数组自动展开为 `[]`）；存量值不在当前枚举里时（schema 漂移）同样作为保留项
 *   出现，不回写丢失；
 * - 「方式」两态：模型填写 → 铸造直链（`url`）/ 从其他字段派生（`url:from=…`，
 *   目标字段不让模型填，值从来源路径读出后铸造）；
 * - 派生模式做**形状相容**即时校验（来源与目标数组层级须一一对应，仅末段键名可不同）；
 * - 清单外工具（服务改版/截断）保留展示并标徽，不静默丢弃；
 * - 无效行（工具/路径为空、路径语法非法、派生形状不符）**不写入**序列化结果，
 *   行内红字提示原因——写入 `MCP.json` 的永远是通过判据的行。
 *
 * 路径语法与校验判据与 `agent-backend/src/domain/file-arg-path.ts` **同构**
 * （平台侧只做编辑辅助，服务端仍是权威）：分段用 `.`，数组写 `[]`（每个元素），
 * 不支持下标。
 */
import { computed, ref, watch } from 'vue'
import type { McpToolInfo } from '../../api/types'

const props = defineProps<{
  modelValue: Record<string, Record<string, string>>
  tools: McpToolInfo[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, Record<string, string>>): void
}>()

/** 一行 = 一条映射（mode 只为编辑视图，序列化时还原为 "url" / "url:from=…"） */
interface MappingRow {
  tool: string
  path: string
  mode: 'url' | 'derive'
  from: string
}

/* ---------- 路径语法判据（与 agent-backend file-arg-path.ts 同构） ---------- */

const SEGMENT = /^([^.[\]]+)(\[\])?$/

const PATH_SYNTAX_HINT = '参数名或取值路径（如 image、items[].excelFileUrl）'

function parsePath(raw: string): { key: string; array: boolean }[] | null {
  if (raw === '') return null
  const steps: { key: string; array: boolean }[] = []
  for (const segment of raw.split('.')) {
    const matched = SEGMENT.exec(segment)
    if (!matched) return null
    steps.push({ key: matched[1]!, array: matched[2] === '[]' })
  }
  return steps
}

const FROM_PREFIX = 'url:from='

function parseMode(value: string): { mode: 'url' | 'derive'; from: string } {
  if (value === 'url') return { mode: 'url', from: '' }
  if (value.startsWith(FROM_PREFIX)) return { mode: 'derive', from: value.slice(FROM_PREFIX.length) }
  // 非法值按直链模式兜底展示（序列化时该行会被判据拦下）
  return { mode: 'url', from: '' }
}

/** 派生模式形状相容：段数相同，除末段外逐段一致（键名与是否数组都相同） */
function compatibleFromPath(targetPath: string, fromPath: string): boolean {
  const target = parsePath(targetPath)
  const from = parsePath(fromPath)
  if (!target || !from || target.length !== from.length) return false
  for (let i = 0; i < target.length - 1; i += 1) {
    if (target[i]!.key !== from[i]!.key || target[i]!.array !== from[i]!.array) return false
  }
  return true
}

/* ---------- 从工具参数的 JSON Schema 递归枚举叶子路径 ---------- */

interface SchemaNode {
  type?: string
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  $ref?: string
}

/** 叶子路径全量枚举；数组自动带 `[]`，`$ref` 沿访问路径剪枝防循环 */
function enumeratePaths(schema: unknown): string[] {
  const out: string[] = []
  ;(function walk(node: SchemaNode | undefined | null, prefix: string, seen: Set<string>) {
    if (!node || typeof node !== 'object') return
    if (node.$ref) {
      if (seen.has(node.$ref)) return
      seen.add(node.$ref)
    }
    if (node.properties) {
      for (const [key, value] of Object.entries(node.properties)) {
        walk(value, prefix === '' ? key : `${prefix}.${key}`, new Set(seen))
      }
    } else if (node.items) {
      walk(node.items, `${prefix}[]`, new Set(seen))
    } else if (prefix !== '') {
      out.push(prefix)
    }
  })(schema as SchemaNode, '', new Set())
  return out
}

function pathsOf(toolName: string): string[] {
  const tool = props.tools.find((t) => t.name === toolName)
  return tool ? enumeratePaths(tool.parameters) : []
}

/**
 * 下拉选项 = Schema 枚举的叶子路径 + 存量值保留项。
 * 只能下拉选择（不许手填），因此已保存但当前枚举不到的值必须作为额外选项保留，
 * 否则 schema 漂移/服务改版后存量配置会被静默丢掉。
 */
function pathOptions(toolName: string, current: string): string[] {
  const enumerated = pathsOf(toolName)
  if (current !== '' && !enumerated.includes(current)) return [...enumerated, current]
  return enumerated
}

/**
 * 来源字段选项 = 与**目标形状相容**的路径（纯下拉语义：能选到的必然合法）。
 * 不相容的存量值（配置漂移）仍作为保留项出现，行内报错提示，不回写丢失。
 */
function fromOptions(row: MappingRow): string[] {
  return pathOptions(row.tool, row.from).filter((path) => compatibleFromPath(row.path, path))
}

/* ---------- 行模型 ↔ file_args 互转 ---------- */

function fileArgsToRows(fileArgs: Record<string, Record<string, string>>): MappingRow[] {
  const list: MappingRow[] = []
  for (const [tool, mapping] of Object.entries(fileArgs)) {
    for (const [path, value] of Object.entries(mapping)) {
      const { mode, from } = parseMode(value)
      list.push({ tool, path, mode, from })
    }
  }
  return list
}

/** 该行是否通过判据（不通过的不写入序列化结果） */
function rowValid(row: MappingRow): boolean {
  if (row.tool.trim() === '' || parsePath(row.path) === null) return false
  if (row.mode === 'derive') {
    return parsePath(row.from) !== null && compatibleFromPath(row.path, row.from)
  }
  return true
}

function rowsToFileArgs(list: MappingRow[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const row of list) {
    if (!rowValid(row)) continue
    const tool = row.tool.trim()
    ;(out[tool] ??= {})[row.path] = row.mode === 'derive' ? `${FROM_PREFIX}${row.from}` : 'url'
  }
  return out
}

/* ---------- 编辑状态 ---------- */

const rows = ref<MappingRow[]>([])

/**
 * 自己 emit 的**回声不重建**编辑态：`v-model` 回传的值与本组件上次 emit 的
 * 序列化结果一致时跳过——否则编辑中的无效行（如派生模式来源未填）不在序列化
 * 结果里，重建会把整行丢掉（2026-09-19 实踩）。只有外部真正换数据（切换服务等）
 * 才重建。
 */
const lastEmitted = ref<string | null>(null)

watch(
  () => props.modelValue,
  (next) => {
    if (JSON.stringify(next) === lastEmitted.value) return
    rows.value = fileArgsToRows(next)
  },
  { immediate: true, deep: true },
)

function commit(): void {
  const value = rowsToFileArgs(rows.value)
  lastEmitted.value = JSON.stringify(value)
  emit('update:modelValue', value)
}

function setRow(index: number, key: 'tool' | 'path' | 'mode' | 'from', value: string): void {
  const row = rows.value[index]!
  if (key === 'mode') {
    row.mode = value === 'derive' ? 'derive' : 'url'
  } else {
    row[key] = value
  }
  commit()
}

function removeRow(index: number): void {
  rows.value.splice(index, 1)
  commit()
}

function addRow(): void {
  rows.value.push({ tool: '', path: '', mode: 'url', from: '' })
}

/** 行级错误（工具/路径为空、语法非法、派生形状不符） */
function rowError(row: MappingRow): string {
  if (row.tool.trim() === '') return '工具名必填'
  if (parsePath(row.path) === null) return `路径非法：${PATH_SYNTAX_HINT}，不支持下标`
  if (row.mode === 'derive') {
    if (parsePath(row.from) === null) return `来源路径非法：${PATH_SYNTAX_HINT}`
    if (!compatibleFromPath(row.path, row.from)) {
      return '来源与目标结构须一一对应（数组层级一致，仅末段字段名可不同）'
    }
  }
  return ''
}

/** 重复的（工具, 路径）映射 */
const duplicateError = computed(() => {
  const seen = new Set<string>()
  for (const row of rows.value) {
    if (row.tool.trim() === '' || row.path.trim() === '') continue
    const key = `${row.tool}|${row.path}`
    if (seen.has(key)) return `重复的映射：${row.tool} · ${row.path}`
    seen.add(key)
  }
  return ''
})

/** 清单外工具（服务改版/清单截断）：保留行、标徽提示，不静默丢弃 */
function isOrphan(tool: string): boolean {
  return tool !== '' && !props.tools.some((t) => t.name === tool)
}
</script>

<template>
  <fieldset class="file-args-table">
    <legend class="field__label">URL铸造参数设置</legend>
    <p class="field__hint">
      指明哪些入参由运行环境铸造为签名直链。工具与字段都只能下拉选择（字段来自该工具的参数
      Schema 枚举，数组自动展开为每个元素）；「派生」表示该字段不让模型填、值从另一个字段读出后铸造。
      已保存但当前清单/Schema 中不存在的值会作为保留项出现在下拉里；标红的行不会写入配置。
    </p>

    <table v-if="rows.length > 0" class="file-args-table__grid">
      <thead>
        <tr>
          <th>工具</th>
          <th>目标字段</th>
          <th>方式</th>
          <th>来源字段（仅派生）</th>
          <th aria-label="操作" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="`${row.tool}-${row.path}-${index}`">
          <td>
            <select
              :value="row.tool"
              :data-test="`row-tool-${index}`"
              @change="setRow(index, 'tool', ($event.target as HTMLSelectElement).value)"
            >
              <option value="" disabled>（选工具）</option>
              <option v-for="tool in tools" :key="tool.name" :value="tool.name">{{ tool.name }}</option>
              <option v-if="isOrphan(row.tool)" :value="row.tool">{{ row.tool }}（清单外）</option>
            </select>
          </td>
          <td>
            <select
              :value="row.path"
              :class="{ invalid: rowError(row) !== '' && parsePath(row.path) === null }"
              :data-test="`row-path-${index}`"
              @change="setRow(index, 'path', ($event.target as HTMLSelectElement).value)"
            >
              <option value="" disabled>（选字段）</option>
              <option v-for="path in pathOptions(row.tool, row.path)" :key="path" :value="path">
                {{ path }}
              </option>
            </select>
          </td>
          <td>
            <select
              :value="row.mode"
              :data-test="`row-mode-${index}`"
              @change="setRow(index, 'mode', ($event.target as HTMLSelectElement).value)"
            >
              <option value="url">模型填写 → 铸造直链</option>
              <option value="derive">从其他字段派生</option>
            </select>
          </td>
          <td>
            <template v-if="row.mode === 'derive'">
              <select
                :value="row.from"
                :class="{
                  invalid:
                    rowError(row) !== '' && parsePath(row.from) !== null &&
                    !compatibleFromPath(row.path, row.from),
                }"
                :data-test="`row-from-${index}`"
                @change="setRow(index, 'from', ($event.target as HTMLSelectElement).value)"
              >
                <option value="" disabled>（选来源字段）</option>
                <option v-for="path in fromOptions(row)" :key="path" :value="path">
                  {{ path }}
                </option>
              </select>
            </template>
            <span v-else class="file-args-table__dash">—</span>
          </td>
          <td>
            <button
              type="button"
              class="btn btn--sm"
              :aria-label="`删除映射 ${row.tool} ${row.path}`"
              :data-test="`row-remove-${index}`"
              @click="removeRow(index)"
            >
              ✕
            </button>
            <div v-if="rowError(row) !== ''" class="file-args-table__error" role="alert">
              {{ rowError(row) }}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="field__hint">当前未配置任何文件参数映射（合法：该服务的入参不含文件）。</p>

    <p v-if="duplicateError !== ''" class="file-args-table__error" role="alert">
      {{ duplicateError }}
    </p>

    <div class="file-args-table__add">
      <button type="button" class="btn" data-test="add-mapping" @click="addRow">+ 添加映射</button>
    </div>
  </fieldset>
</template>

<style scoped>
.file-args-table {
  margin: 0 0 var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.file-args-table__grid {
  width: 100%;
  border-collapse: collapse;
  margin-top: var(--space-2);
}

.file-args-table__grid th,
.file-args-table__grid td {
  text-align: left;
  padding: var(--space-1) var(--space-2) var(--space-1) 0;
  vertical-align: top;
  font-size: var(--font-size-sm);
}

.file-args-table__grid th {
  color: var(--color-text-muted);
  font-weight: 600;
  font-size: var(--font-size-xs);
}

.file-args-table__dash {
  color: var(--color-text-muted);
}

.file-args-table__error {
  color: var(--color-status-error);
  font-size: var(--font-size-xs);
  margin-top: 2px;
}

.file-args-table__add {
  margin-top: var(--space-2);
}

input.invalid {
  border-color: var(--color-status-error);
}
</style>
