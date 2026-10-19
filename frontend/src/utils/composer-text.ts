/**
 * 输入区（contenteditable）的文本序列化与 `@` 引用分段（2026-10-18）。
 *
 * 背景：输入区从 `<textarea>` 改成富文本容器后，正文里同时存在三类节点——
 * 文本、换行 `<br>`、以及不可编辑的**引用胶囊**（`@文件名`）。而上层的草稿、
 * `@` 触发检测、发送载荷仍只认字符串，因此「DOM → 文本」的规则必须只有一处实现，
 * 否则输入框看到的和发出去的迟早对不上。
 *
 * 三条约定：
 * - 胶囊的**文本**就是它的标记（`@文件名`），序列化时从 `data-mention-filename` 取，
 *   因此胶囊被整体删除时标记随之消失，`useFileMention.handleInput` 的反向同步照旧成立；
 * - 分段（文本 / 胶囊）由调用方传入的标记拼写驱动，本文件不另造 `@` 拼写规则
 *   （唯一来源是 `mentionToken`）；
 * - 拿不到选区时（jsdom 等无布局环境）一律回退为「文末」，调用方无需分支。
 */

/** 胶囊上的文件名属性：序列化与定位都读它，MUST NOT 改用 `textContent`（胶囊里还有按钮）。 */
export const MENTION_FILENAME_ATTR = 'data-mention-filename'

/** 正文的一段：普通文本，或一条完整的 `@文件名` 标记。 */
export type ComposerSegment = { kind: 'text'; text: string } | { kind: 'mention'; token: string }

/** 浏览器回车产生的块级包裹（正常路径已拦截 Enter，这里只兜住输入法/粘贴的漏网）。 */
const BLOCK_TAGS: ReadonlySet<string> = new Set(['DIV', 'P', 'LI'])

const ELEMENT_NODE = 1
const TEXT_NODE = 3

/** 当前选区；环境不支持时返回 `null`。 */
function currentSelection(): Selection | null {
  return typeof document.getSelection === 'function' ? document.getSelection() : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 单个节点的文本贡献（`serializeComposerText` 的递归单元）。 */
function nodeText(node: Node): string {
  if (node.nodeType === TEXT_NODE) return node.nodeValue ?? ''
  if (node.nodeType !== ELEMENT_NODE) return ''

  const element = node as HTMLElement
  if (element.tagName === 'BR') return '\n'

  const filename = element.getAttribute(MENTION_FILENAME_ATTR)
  if (filename !== null) return `@${filename}`

  const inner = Array.from(element.childNodes).map(nodeText).join('')
  // 块级包裹是浏览器回车/粘贴的兜底产物：按行处理，否则两行会粘成一行
  return BLOCK_TAGS.has(element.tagName) ? `${inner}\n` : inner
}

/**
 * 把输入区（或任意片段）的**子节点**序列化为草稿文本。
 *
 * 规则：文本节点原样；`<br>` → `\n`；胶囊 → 它的 `@文件名` 标记；块级子元素末尾补 `\n`。
 * 传容器的子节点而非容器本身，避免把容器自己的块级规则也算进去。
 */
export function serializeComposerText(root: Node): string {
  return Array.from(root.childNodes).map(nodeText).join('')
}

/**
 * 光标在文本中的下标（与 {@link serializeComposerText} 同一把尺子）。
 *
 * 只克隆「起点 → 光标」这段再序列化，因此 `<br>`、胶囊的贡献与全文一致；
 * 拿不到选区时返回文末下标。
 */
export function caretTextOffset(
  root: Node,
  selection: Selection | null = currentSelection(),
): number {
  const full = serializeComposerText(root)
  if (!selection || selection.rangeCount === 0) return full.length

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return full.length

  const head = document.createRange()
  head.selectNodeContents(root)
  head.setEnd(range.startContainer, range.startOffset)
  return serializeComposerText(head.cloneContents()).length
}

/** 把光标放到输入区末尾（外部改写草稿后重建 DOM 时用）。 */
export function placeCaretAtEnd(root: HTMLElement): void {
  const selection = currentSelection()
  if (!selection) return

  const range = document.createRange()
  range.selectNodeContents(root)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * 按 `@文件名` 标记把文本切成「普通文本 / 引用」片段。
 *
 * 标记拼写由调用方给出（`mentionToken` 是唯一来源）；长的优先匹配，
 * 避免 `@a.csv` 把 `@a.csv.bak` 吃掉一半。
 */
export function splitComposerSegments(text: string, tokens: readonly string[]): ComposerSegment[] {
  const list = [...new Set(tokens.filter((token) => token !== ''))].sort(
    (left, right) => right.length - left.length,
  )
  if (list.length === 0) return text === '' ? [] : [{ kind: 'text', text }]

  const pattern = new RegExp(list.map(escapeRegExp).join('|'), 'g')
  const segments: ComposerSegment[] = []
  let cursor = 0

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) segments.push({ kind: 'text', text: text.slice(cursor, index) })
    segments.push({ kind: 'mention', token: match[0] })
    cursor = index + match[0].length
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
  return segments
}
