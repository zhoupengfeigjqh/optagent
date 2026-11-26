import {
  controlOf,
  isPlainObject,
  itemSchemaOf,
  propertiesOf,
  requiredSetOf,
  type FieldSchema,
} from './arg-schema'
import { formatPath, type NodePath } from './json-path'

export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  return typeof value === 'string' && value.trim() === ''
}

export function isNumericValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string' && value.trim() !== '') return Number.isFinite(Number(value))
  return false
}

export function validateArgs(schema: FieldSchema, value: unknown): string {
  return checkObject(schema, value, [])
}

function checkObject(schema: FieldSchema, value: unknown, path: NodePath): string {
  const node = isPlainObject(value) ? value : {}
  const required = requiredSetOf(schema)
  for (const { key, schema: child } of propertiesOf(schema)) {
    const error = checkNode(child, node[key], [...path, key], required.has(key))
    if (error !== '') return error
  }
  return ''
}

function checkNode(schema: FieldSchema, value: unknown, path: NodePath, required: boolean): string {
  const control = controlOf(schema)

  if (control === 'group') {
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

  if (control === 'json') return required && isEmptyValue(value) ? `${label(path)}为必填项` : ''

  if (isEmptyValue(value)) return required ? `${label(path)}为必填项` : ''
  if (control === 'number' && !isNumericValue(value)) return `${label(path)}须为数字`
  return ''
}

function label(path: NodePath): string {
  return `参数「${formatPath(path)}」`
}

export function buildArgs(schema: FieldSchema, value: unknown): Record<string, unknown> {
  const result = prune(coerce(schema, value))
  return isPlainObject(result) ? result : {}
}

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
  if (control === 'number' && typeof value === 'string' && isNumericValue(value))
    return Number(value)
  return value
}

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
