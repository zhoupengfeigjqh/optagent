
export type NodePath = readonly (string | number)[]

export function formatPath(path: NodePath): string {
  let text = ''
  for (const segment of path) {
    if (typeof segment === 'number') text += `[${segment}]`
    else text = text === '' ? segment : `${text}.${segment}`
  }
  return text
}

export function pathKey(path: NodePath): string {
  return JSON.stringify(path)
}

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

export type SetAtPathResult = { ok: true; value: unknown } | { ok: false; error: string }

export function setAtPath(root: unknown, path: NodePath, value: unknown): SetAtPathResult {
  return writeAt(root, path, value, [])
}

function writeAt(root: unknown, path: NodePath, value: unknown, walked: NodePath): SetAtPathResult {
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

function arrayContainer(
  root: unknown,
  walked: NodePath,
  target: string,
): { ok: true; value: unknown[] } | { ok: false; error: string } {
  if (root === undefined || root === null) return { ok: true, value: [] }
  if (Array.isArray(root)) return { ok: true, value: [...root] }
  return { ok: false, error: `${at(walked)}不是数组，无法写入「${target}」` }
}

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

function at(walked: NodePath): string {
  return walked.length > 0 ? `「${formatPath(walked)}」` : '入参'
}
