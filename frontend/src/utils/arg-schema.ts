/**
 * 工具入参 JSON Schema 的**内省**（HITL 弹窗递归表单的唯一判据来源）。
 *
 * 弹窗的红线是"不含任何具体工具/MCP 服务名"：控件形态必须**只**由 schema 推导。推导集中成
 * 这里的纯函数（可单测），组件只消费结论——这样任何 MCP 工具（无论嵌套多深）都自动获得
 * 一致的渲染，不需要为某个工具写适配。
 *
 * 控件映射（JSON Schema 子集）：
 * - `enum`（以及 `const` / `anyOf`/`oneOf` 的常量集合）→ 下拉；`boolean` → 开关；
 *   `integer`/`number` → 数字；`string` → 文本
 *   （description 含「多行」→ 多行文本）
 * - `object` 且声明了 `properties` → **分组**：子字段逐个成行（递归，支持任意深度）；
 *   未声明 `properties` 的自由对象（如任意键值 map）→ JSON 逃生舱
 * - `array` 且 `items.type=object` → **表格**：一行一个元素；列 = `items.properties` 的键，
 *   不足时再补"值里实际出现的键"（规则清单这类行的键来自数据而非 schema）
 * - `array` 且 `items` 是标量/枚举 → **列表**：一行一个元素
 * - 其余（`items` 缺失、数组套数组、`oneOf` 等表格表达不了的形状）→ JSON 逃生舱
 *
 * 与运行环境 `rules-field-path.ts` 的分工：那里判"`rules_field` 这条声明说得通吗"（只走对象），
 * 这里判"渲染成什么控件"，两者独立、互不依赖。
 */

/** schema 里我们关心的子集（其余键一律忽略，不改写 schema 本身）。 */
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

/** 控件形态（递归渲染的分派依据）。 */
export type ControlKind =
  'select' | 'switch' | 'number' | 'textarea' | 'text' | 'group' | 'table' | 'list' | 'json'

/** 标量类控件（表格单元格与列表元素都用它们）。 */
export function isScalarControl(control: ControlKind): boolean {
  return control !== 'group' && control !== 'table' && control !== 'list' && control !== 'json'
}

/**
 * 文本类控件：`@` 文件引用与结构化文件卡片只挂在这两种上。
 * （下拉/开关/数字/JSON 里插路径没有语义，见 `usePathInsert` 的约定。）
 */
export function isTextControl(control: ControlKind): boolean {
  return control === 'text' || control === 'textarea'
}

/** 宽松取值：非对象一律当空 schema（schema 来自外部服务，形状不可全信）。 */
export function asSchema(raw: unknown): FieldSchema {
  return isPlainObject(raw) ? (raw as FieldSchema) : {}
}

/** 普通对象判定（数组与 null 都不算）。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 该节点的控件形态。 */
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

/** 数组元素 schema → 数组控件形态。 */
function arrayControlOf(items: FieldSchema | null): ControlKind {
  if (items === null) return 'json'
  if (items.type === 'object') return 'table'
  if (items.type === 'array') return 'json'
  if (optionsOf(items).length > 0) return 'list'
  if (items.type === 'string' || items.type === 'number' || items.type === 'integer') return 'list'
  if (items.type === 'boolean') return 'list'
  return 'json'
}

/** 对象的子字段（保持 schema 里的键顺序；无 `properties` → 空数组）。 */
export function propertiesOf(schema: FieldSchema): Array<{ key: string; schema: FieldSchema }> {
  if (!isPlainObject(schema.properties)) return []
  return Object.entries(schema.properties).map(([key, raw]) => ({ key, schema: asSchema(raw) }))
}

/** 该层级的 required 集合。 */
export function requiredSetOf(schema: FieldSchema): Set<string> {
  const raw = Array.isArray(schema.required) ? schema.required : []
  return new Set(raw.filter((key): key is string => typeof key === 'string'))
}

/** 数组元素的 schema（无 `items` → null）。 */
export function itemSchemaOf(schema: FieldSchema): FieldSchema | null {
  if (schema.items === undefined || schema.items === null) return null
  if (Array.isArray(schema.items)) return null // 元组形式：表格表达不了，交 JSON
  return asSchema(schema.items)
}

/**
 * 下拉选项：`enum` 优先，其次 `const`（单值），再次 `anyOf`/`oneOf` 里的常量集合。
 *
 * `anyOf`/`oneOf` 在 JSON Schema 里也用于表达联合**类型**（如 `{anyOf:[{type:'string'},{type:'null'}]}`），
 * 那不是选项——因此只在**每个分支都能取出具体常量**时才认作枚举，否则整体交回非下拉。
 */
export function optionsOf(schema: FieldSchema): unknown[] {
  if (Array.isArray(schema.enum)) return schema.enum
  if (schema.const !== undefined) return [schema.const]
  return unionOptionsOf(schema.anyOf ?? schema.oneOf)
}

/** `anyOf`/`oneOf` → 常量选项集合（有任一分支不是常量集合 → 空，不猜）。 */
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

/** 节点说明（无 → 空串）。 */
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

/**
 * 按值路径取出对应的 schema 节点（对象键走 `properties`、下标走 `items`）。
 * 路径在 schema 里走不通 → `null`（调用方据此退化为 JSON 文本框）。
 */
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

/**
 * 「从算法规则选择」入口的落点：`rules_field` 能被**结构化渲染到**的最长前缀。
 *
 * - 全路径都渲染得出（如 `input.targetPriorities` 且 `input` 是分组）→ 落点就是目标那一行，
 *   `exact = true`，按钮与它要影响的表格在同一行；
 * - 中途撞上 JSON 逃生舱（祖先对象未声明 `properties`，子字段没有独立行）→ 落点在截断处那一行，
 *   `exact = false`；写回仍按**完整路径**深写，只是入口位置退到最近可见的那一行。
 */
export function rulesAnchorOf(
  schema: FieldSchema,
  rulesPath: readonly (string | number)[],
): { anchor: (string | number)[]; exact: boolean } {
  const anchor: (string | number)[] = []
  let node: FieldSchema = schema
  for (const segment of rulesPath) {
    const next = schemaAtPath(node, [segment])
    if (next === null) break
    // 走到 JSON 逃生舱且后面还有段：该节点的子字段没有独立行，落点停在它自己这一行
    if (controlOf(next) === 'json' && anchor.length + 1 < rulesPath.length) {
      anchor.push(segment)
      return { anchor, exact: false }
    }
    anchor.push(segment)
    node = next
  }
  return { anchor, exact: anchor.length === rulesPath.length }
}

/** title 与参数名的「同义」归一：忽略大小写与分隔符（`State File` ≡ `state_file` ≡ `state-file`）。 */
function labelKeyOf(text: string): string {
  return text.toLowerCase().replace(/[\s_-]/g, '')
}

/**
 * 字段的**主标签**（2026-10-27）：`title` 优先，缺失 / 空白 / 只是参数名的排版变体时回退参数名。
 *
 * 主标签只能是「一个名字」。此前的做法是「参数名 + 右侧灰色短标签」，中文 title 一多就会出现
 * `path 文件路径` 这种一行两个名字的读法；现在 title 直接替代参数名，`description` 仍完整收在
 * 「?」气泡里，信息不丢。
 *
 * 回退判据用 `labelKeyOf` 而不是 `toLowerCase`：MCP 服务端 SDK 自动生成的 title 常见
 * `Image` / `State File`，它们不是人写的名字，直接顶上去会让弹窗比参数名更难懂。
 */
export function fieldLabelOf(name: string, schema: FieldSchema): string {
  if (typeof schema.title === 'string') {
    const title = schema.title.trim()
    if (title !== '' && labelKeyOf(title) !== labelKeyOf(name)) return title
  }
  return name
}

/**
 * 同层 `title` 去重（`title` 唯一性约束的运行时兜底）：同一对象 / 同一张表内重复的 title
 * 只保留**先出现**的那个，其余删除 title 回退参数名。
 *
 * 为什么需要兜底：title 由 MCP 服务端（或内置工具目录）提供，平台侧不改写它；两个字段同叫
 * 「名称」时弹窗会出现两行同名，用户无法区分，而回退参数名至少可区分。去重只作用于**同一层**
 * （`properties` 与 `items` 各自独立），跨层同名不算冲突。
 */
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

  // 结构不变，只可能删掉 title：断言回入参类型，调用方无需再收窄
  return next as unknown as T
}
