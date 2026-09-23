/**
 * 工具入参 JSON Schema 的**内省**（HITL 弹窗递归表单的唯一判据来源）。
 *
 * 弹窗的红线是"不含任何具体工具/MCP 服务名"：控件形态必须**只**由 schema 推导。推导集中成
 * 这里的纯函数（可单测），组件只消费结论——这样任何 MCP 工具（无论嵌套多深）都自动获得
 * 一致的渲染，不需要为某个工具写适配。
 *
 * 控件映射（JSON Schema 子集）：
 * - `enum` → 下拉；`boolean` → 开关；`integer`/`number` → 数字；`string` → 文本
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
  title?: unknown
  description?: unknown
  properties?: unknown
  required?: unknown
  items?: unknown
}

/** 控件形态（递归渲染的分派依据）。 */
export type ControlKind =
  | 'select'
  | 'switch'
  | 'number'
  | 'textarea'
  | 'text'
  | 'group'
  | 'table'
  | 'list'
  | 'json'

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

/** enum 选项（非数组 → 空）。 */
export function optionsOf(schema: FieldSchema): unknown[] {
  return Array.isArray(schema.enum) ? schema.enum : []
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
export function schemaAtPath(schema: FieldSchema, path: readonly (string | number)[]): FieldSchema | null {
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

/** 参数名旁的中文短标签（title 或 description 首句提炼；无信息 → 空串）。 */
export function labelHintOf(name: string, schema: FieldSchema): string {
  if (typeof schema.title === 'string') {
    const title = schema.title.trim()
    // 自动生成的大小写变体（FastMCP 的 "Image"）与参数名同义，视为无信息
    if (title !== '' && title.toLowerCase() !== name.toLowerCase()) return title
  }
  const description = descriptionOf(schema)
  if (description === '') return ''
  const first = /^[^。；;.;\n\r]+/.exec(description.trim())?.[0]?.trim() ?? ''
  if (first === '') return ''
  return first.length > 24 ? `${first.slice(0, 24)}…` : first
}
