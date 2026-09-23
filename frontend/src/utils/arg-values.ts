/**
 * 入参**值**层：本地校验与提交构建（HITL 弹窗）。
 *
 * 与 `arg-schema.ts` 的分工：那里决定"渲染成什么控件"，这里决定"填得对不对"与"提交什么"。
 * 两者都只依赖 schema、都不含任何工具名——弹窗的解耦红线由这两个模块共同守住。
 *
 * 校验强度刻意与改造前**等价**（服务端终验才是权威，前端只做体验）：required 缺失、数字类型、
 * JSON 可解析。新增的只有"结构化渲染后必须成立的形状"（对象须为对象、数组须为数组）——
 * 这类值在改造前会以 JSON 文本提交、由服务端拒绝，现在提前在本地说清，不改变"什么算合法"。
 */
import {
  controlOf,
  isPlainObject,
  itemSchemaOf,
  propertiesOf,
  requiredSetOf,
  type FieldSchema,
} from './arg-schema'
import { formatPath, type NodePath } from './json-path'

/** "未填"判定：`undefined` / `null` / 空白串（与既有 textarea 口径一致）。 */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  return typeof value === 'string' && value.trim() === ''
}

/** 数字判定：真数字，或能整体转成有限数字的字符串（输入框里未收敛的中间态）。 */
export function isNumericValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string' && value.trim() !== '') return Number.isFinite(Number(value))
  return false
}

/**
 * 本地校验：返回**可直接展示**的中文原因（空串 = 通过）。
 *
 * 只报第一个错误：逐条报会淹没在长表单里，且服务端终验会补齐其余。
 * required 一律由**父级** schema 的 `required` 传入——与 JSON Schema 语义一致
 * （父级缺失时，子级的 required 不适用）。
 */
export function validateArgs(schema: FieldSchema, value: unknown): string {
  return checkObject(schema, value, [])
}

/** 校验一个"对象层"（顶层入参，或表格的一行）的子字段。 */
function checkObject(schema: FieldSchema, value: unknown, path: NodePath): string {
  const node = isPlainObject(value) ? value : {}
  const required = requiredSetOf(schema)
  for (const { key, schema: child } of propertiesOf(schema)) {
    const error = checkNode(child, node[key], [...path, key], required.has(key))
    if (error !== '') return error
  }
  return ''
}

/** 校验单个节点。 */
function checkNode(schema: FieldSchema, value: unknown, path: NodePath, required: boolean): string {
  const control = controlOf(schema)

  if (control === 'group') {
    // 父级缺失时不下钻：required 只对"存在的对象"生效（JSON Schema 语义）
    if (isEmptyValue(value)) return required ? `${label(path)}为必填项` : ''
    if (!isPlainObject(value)) return `${label(path)}须为对象`
    return checkObject(schema, value, path)
  }

  if (control === 'table' || control === 'list') {
    if (isEmptyValue(value)) return required ? `${label(path)}为必填项` : ''
    if (!Array.isArray(value)) return `${label(path)}须为数组`
    if (value.length === 0) return required ? `${label(path)}为必填项（至少一行）` : ''
    const items = itemSchemaOf(schema)
    if (items === null) return ''
    for (const [index, element] of value.entries()) {
      if (control === 'list') {
        const error = checkNode(items, element, [...path, index], false)
        if (error !== '') return error
        continue
      }
      if (!isPlainObject(element)) return `${label([...path, index])}须为对象`
      const error = checkObject(items, element, [...path, index])
      if (error !== '') return error
    }
    return ''
  }

  // JSON 逃生舱：值已由编辑态解析过（文本非法由调用方按草稿拦下），这里只看是否填了
  if (control === 'json') return required && isEmptyValue(value) ? `${label(path)}为必填项` : ''

  if (isEmptyValue(value)) return required ? `${label(path)}为必填项` : ''
  if (control === 'number' && !isNumericValue(value)) return `${label(path)}须为数字`
  return ''
}

/** 错误文案里的字段名（用值路径，长表单里也能一眼定位到是哪一个）。 */
function label(path: NodePath): string {
  return `参数「${formatPath(path)}」`
}

/**
 * 提交构建：深拷贝 → 类型收敛（数字控件里的数字串转数字）→ 剪枝（丢弃未填的可选项）。
 *
 * 剪枝是既有口径：改造前"空文本框"的参数根本不进 `args`，服务端因此不会收到空串
 * （否则 `file_args` 铸造、沙箱路径校验会把空串当路径处理）。
 * 只丢弃 `undefined` 与空白串，`null`/`false`/`0`/空数组一律保留（改造前也保留）。
 */
export function buildArgs(schema: FieldSchema, value: unknown): Record<string, unknown> {
  const result = prune(coerce(schema, value))
  return isPlainObject(result) ? result : {}
}

/** 剪枝判据：只有 `undefined` 与空白串算"未填"。 */
function isDropped(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.trim() === '')
}

/**
 * 数组元素级判据：整行/整项留空（剪枝后成了空对象）也算"未填"。
 *
 * 只对**数组元素**生效：那是表格里的"行"与列表里的"项"，用户加了一行却什么都没填属于噪声
 * （顶层那种显式空容器如 `[]` 是模型/用户明确表达的空清单，必须保留）。
 */
function isEmptyRow(value: unknown): boolean {
  return isDropped(value) || (isPlainObject(value) && Object.keys(value).length === 0)
}

/** 按 schema 收敛类型：数字控件接受数字串（输入框的中间态）。 */
function coerce(schema: FieldSchema, value: unknown): unknown {
  const control = controlOf(schema)
  if (control === 'group') {
    if (!isPlainObject(value)) return value
    const next: Record<string, unknown> = { ...value }
    for (const { key, schema: child } of propertiesOf(schema)) {
      if (key in next) next[key] = coerce(child, next[key])
    }
    return next
  }
  if (control === 'table' || control === 'list') {
    if (!Array.isArray(value)) return value
    const items = itemSchemaOf(schema)
    return items === null ? [...value] : value.map((element) => coerce(items, element))
  }
  if (control === 'number' && typeof value === 'string' && isNumericValue(value)) return Number(value)
  return value
}

/** 递归剪枝：丢弃 `undefined` 与空白串（数组里的空行一并去掉），其余原样保留。 */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune).filter((element) => !isEmptyRow(element))
  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {}
    for (const [key, element] of Object.entries(value)) {
      const pruned = prune(element)
      if (isDropped(pruned)) continue
      next[key] = pruned
    }
    return next
  }
  return value
}

/**
 * 模型起点：只保留 schema 里出现过的顶层键。
 *
 * 目的是"看不见的不提交"：schema 之外的顶层键在表单里没有对应控件，若原样带进模型，
 * 用户会在不知情的情况下把它们提交出去（改造前只遍历 schema，同样不会提交）。
 */
export function pickKnownKeys(
  schema: FieldSchema,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const keys = requiredSetOf(schema)
  for (const { key } of propertiesOf(schema)) keys.add(key)
  const next: Record<string, unknown> = {}
  for (const [key, element] of Object.entries(value)) {
    if (keys.has(key)) next[key] = element
  }
  return next
}
