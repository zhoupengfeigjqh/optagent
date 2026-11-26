
export interface FieldSchema {
  type?: unknown
  enum?: unknown
  const?: unknown
  anyOf?: unknown
  oneOf?: unknown
  title?: unknown
  description?: unknown
  properties?: unknown
  required?: unknown
  items?: unknown
}

export type ControlKind =
  'select' | 'switch' | 'number' | 'textarea' | 'text' | 'group' | 'table' | 'list' | 'json'

export function isScalarControl(control: ControlKind): boolean {
  return control !== 'group' && control !== 'table' && control !== 'list' && control !== 'json'
}

export function isTextControl(control: ControlKind): boolean {
  return control === 'text' || control === 'textarea'
}

/** 宽松取值：非对象一律当空 schema（schema 来自外部服务，形状不可全信）。 */
export function asSchema(raw: unknown): FieldSchema {
  return isPlainObject(raw) ? (raw as FieldSchema) : {}
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function controlOf(schema: FieldSchema): ControlKind {
  if (optionsOf(schema).length > 0) return 'select'
  switch (schema.type) {
    case 'boolean':
      return 'switch'
    case 'integer':
    case 'number':
      return 'number'
    case 'object':
      return propertiesOf(schema).length > 0 ? 'group' : 'json'
    case 'array':
      return arrayControlOf(itemSchemaOf(schema))
    case 'string':
      return descriptionOf(schema).includes('多行') ? 'textarea' : 'text'
    default:
      // 未声明 type：有 properties 就当对象分组，否则交 JSON 逃生舱（不猜）
      return propertiesOf(schema).length > 0 ? 'group' : 'json'
  }
}

function arrayControlOf(items: FieldSchema | null): ControlKind {
  if (items === null) return 'json'
  if (items.type === 'object') return 'table'
  if (items.type === 'array') return 'json'
  if (optionsOf(items).length > 0) return 'list'
  if (items.type === 'string' || items.type === 'number' || items.type === 'integer') return 'list'
  if (items.type === 'boolean') return 'list'
  return 'json'
}

export function propertiesOf(schema: FieldSchema): Array<{ key: string; schema: FieldSchema }> {
  if (!isPlainObject(schema.properties)) return []
  return Object.entries(schema.properties).map(([key, raw]) => ({ key, schema: asSchema(raw) }))
}

export function requiredSetOf(schema: FieldSchema): Set<string> {
  const raw = Array.isArray(schema.required) ? schema.required : []
  return new Set(raw.filter((key): key is string => typeof key === 'string'))
}

export function itemSchemaOf(schema: FieldSchema): FieldSchema | null {
  if (schema.items === undefined || schema.items === null) return null
  if (Array.isArray(schema.items)) return null
  return asSchema(schema.items)
}

export function optionsOf(schema: FieldSchema): unknown[] {
  if (Array.isArray(schema.enum)) return schema.enum
  if (schema.const !== undefined) return [schema.const]
  return unionOptionsOf(schema.anyOf ?? schema.oneOf)
}

function unionOptionsOf(raw: unknown): unknown[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const collected: unknown[] = []
  for (const branch of raw) {
    const branchOptions = optionsOf(asSchema(branch))
    if (branchOptions.length === 0) return []
    collected.push(...branchOptions)
  }
  return collected
}

export function descriptionOf(schema: FieldSchema): string {
  return typeof schema.description === 'string' ? schema.description : ''
}

/**
 * 表格列：先按 `items.properties` 的顺序与范围，再补"值里实际出现过的键"。
 *
 * 为什么需要补：规则清单这类行的键来自**数据**（规则文件表头）而非 schema，只认 schema 会
 * 把用户已选的行渲染成一堆看不见的键。两处合并后，schema 声明的列在前、动态列在后。
 */
export function columnKeysOf(itemSchema: FieldSchema, rows: readonly unknown[]): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  const push = (key: string): void => {
    if (seen.has(key)) return
    seen.add(key)
    keys.push(key)
  }
  for (const { key } of propertiesOf(itemSchema)) push(key)
  for (const row of rows) {
    if (!isPlainObject(row)) continue
    for (const key of Object.keys(row)) push(key)
  }
  return keys
}

export function schemaAtPath(
  schema: FieldSchema,
  path: readonly (string | number)[],
): FieldSchema | null {
  let node: FieldSchema = schema
  for (const segment of path) {
    if (typeof segment === 'number') {
      const items = itemSchemaOf(node)
      if (items === null) return null
      node = items
      continue
    }
    const child = propertiesOf(node).find((item) => item.key === segment)
    if (child === undefined) return null
    node = child.schema
  }
  return node
}

export function rulesAnchorOf(
  schema: FieldSchema,
  rulesPath: readonly (string | number)[],
): { anchor: (string | number)[]; exact: boolean } {
  const anchor: (string | number)[] = []
  let node: FieldSchema = schema
  for (const segment of rulesPath) {
    const next = schemaAtPath(node, [segment])
    if (next === null) break
    if (controlOf(next) === 'json' && anchor.length + 1 < rulesPath.length) {
      anchor.push(segment)
      return { anchor, exact: false }
    }
    anchor.push(segment)
    node = next
  }
  return { anchor, exact: anchor.length === rulesPath.length }
}

function labelKeyOf(text: string): string {
  return text.toLowerCase().replace(/[\s_-]/g, '')
}

export function fieldLabelOf(name: string, schema: FieldSchema): string {
  if (typeof schema.title === 'string') {
    const title = schema.title.trim()
    if (title !== '' && labelKeyOf(title) !== labelKeyOf(name)) return title
  }
  return name
}

export function dedupeTitles<T extends FieldSchema>(schema: T): T {
  const next: FieldSchema = { ...schema }

  const properties = schema.properties
  if (properties !== null && typeof properties === 'object' && !Array.isArray(properties)) {
    const seen = new Set<string>()
    const cleaned: Record<string, FieldSchema> = {}
    for (const [key, raw] of Object.entries(properties as Record<string, FieldSchema>)) {
      let child = dedupeTitles(raw)
      const title = typeof child.title === 'string' ? child.title.trim() : ''
      if (title !== '' && labelKeyOf(title) !== labelKeyOf(key)) {
        const labelKey = labelKeyOf(title)
        if (seen.has(labelKey)) {
          const rest: FieldSchema = { ...child }
          delete rest.title
          child = rest
        } else {
          seen.add(labelKey)
        }
      }
      cleaned[key] = child
    }
    next.properties = cleaned
  }

  const items = schema.items
  if (Array.isArray(items)) {
    next.items = items.map((item) => dedupeTitles(item as FieldSchema))
  } else if (items !== null && typeof items === 'object') {
    next.items = dedupeTitles(items as FieldSchema)
  }

  return next as unknown as T
}
