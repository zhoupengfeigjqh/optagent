/**
 * JSON 值的**路径**读写（HITL 弹窗递归表单的定位基础）。
 *
 * 路径段有两类：对象键（string）与数组下标（number），如
 * `['input', 'targetPriorities', 0, 'rulePriority']` ↔ `input.targetPriorities[0].rulePriority`。
 *
 * 为什么要数组下标（2026-09-23）：弹窗改为按 schema **递归**渲染入参——对象逐行、对象数组
 * 渲染成表格——单元格与行的增删都要按下标定位。旧实现只服务"规则数组的深写"（目标必在对象
 * 链上），因此显式拒绝数组段；那条不变式现已由 `rules_field` 的**语法**校验单独承担
 * （`agent-backend/src/domain/rules-field-path.ts`），与这里的"值定位"能力无关。
 *
 * 写入一律返回**新值**、不改入参：模型是响应式根对象，整体替换最不易漏更新。
 */

/** 值路径：对象键与数组下标混排。 */
export type NodePath = readonly (string | number)[]

/**
 * 展示用路径文本：对象键用 `.` 连接、下标写成 `[i]`
 * （如 `input.targetPriorities[0].rulePriority`）。错误文案与界面提示共用同一句。
 */
export function formatPath(path: NodePath): string {
  let text = ''
  for (const segment of path) {
    if (typeof segment === 'number') text += `[${segment}]`
    else text = text === '' ? segment : `${text}.${segment}`
  }
  return text
}

/**
 * 路径的稳定字符串键（按路径索引的映射：JSON 视图开关、JSON 草稿、`@` 引用激活字段）。
 *
 * 用 `JSON.stringify` 而非 `formatPath`：后者在键名含 `.`/`[` 时会产生歧义（两个不同路径得到
 * 同一个键），而这里只要**唯一**；可读性由 `formatPath` 单独负责。
 */
export function pathKey(path: NodePath): string {
  return JSON.stringify(path)
}

/** 沿路径读取；中间层缺失或类型不符 → `undefined`（不抛错）。 */
export function readAtPath(root: unknown, path: NodePath): unknown {
  let node: unknown = root
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(node)) return undefined
      node = node[segment]
      continue
    }
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  return node
}

/** 深写结果：失败时 `error` 为可直接展示给用户的中文原因。 */
export type SetAtPathResult = { ok: true; value: unknown } | { ok: false; error: string }

/**
 * 沿路径深写，返回**新值**（不改入参）。
 *
 * - 中间层缺失（`undefined`/`null`）→ 按该段类型创建空对象或空数组（数组按需补空位）；
 * - 中间层存在但类型不符（该段要对象却是数组/标量，或该段要数组却不是数组）→ 失败并指出
 *   **出问题的容器**与完整目标路径——**不静默覆盖**用户已填的内容；
 * - `path` 为空 → 直接返回 `value`（整段替换，与既有语义一致）。
 */
export function setAtPath(root: unknown, path: NodePath, value: unknown): SetAtPathResult {
  return writeAt(root, path, value, [])
}

function writeAt(
  root: unknown,
  path: NodePath,
  value: unknown,
  walked: NodePath,
): SetAtPathResult {
  if (path.length === 0) return { ok: true, value }

  const [head, ...rest] = path
  const target = formatPath([...walked, ...path])

  if (typeof head === 'number') {
    const container = arrayContainer(root, walked, target)
    if (!container.ok) return container
    while (container.value.length <= head) container.value.push(undefined)
    const child = writeAt(container.value[head], rest, value, [...walked, head])
    if (!child.ok) return child
    container.value[head] = child.value
    return { ok: true, value: container.value }
  }

  const container = objectContainer(root, walked, target)
  if (!container.ok) return container
  const child = writeAt(container.value[head], rest, value, [...walked, head])
  if (!child.ok) return child
  return { ok: true, value: { ...container.value, [head]: child.value } }
}

/** 取"该段要写入的数组容器"：缺失即创建（新数组），类型不符即拒绝并说明是哪一层。 */
function arrayContainer(
  root: unknown,
  walked: NodePath,
  target: string,
): { ok: true; value: unknown[] } | { ok: false; error: string } {
  if (root === undefined || root === null) return { ok: true, value: [] }
  if (Array.isArray(root)) return { ok: true, value: [...root] }
  return { ok: false, error: `${at(walked)}不是数组，无法写入「${target}」` }
}

/** 取"该段要写入的对象容器"：缺失即创建（新对象），类型不符即拒绝并说明是哪一层。 */
function objectContainer(
  root: unknown,
  walked: NodePath,
  target: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (root === undefined || root === null) return { ok: true, value: {} }
  if (typeof root === 'object' && !Array.isArray(root)) {
    return { ok: true, value: { ...(root as Record<string, unknown>) } }
  }
  return { ok: false, error: `${at(walked)}不是对象，无法写入「${target}」` }
}

/** 错误文案里的"出问题的容器"（空路径 = 入参本身）。 */
function at(walked: NodePath): string {
  return walked.length > 0 ? `「${formatPath(walked)}」` : '入参'
}
