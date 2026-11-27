
/** 胶囊上的文件名属性：序列化与定位都读它，MUST NOT 改用 `textContent`（胶囊里还有按钮）。 */
export const MENTION_FILENAME_ATTR = 'data-mention-filename'

export const SKILL_NAME_ATTR = 'data-skill-name'

export type ComposerSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; token: string }
  | { kind: 'skill'; token: string }

const BLOCK_TAGS: ReadonlySet<string> = new Set(['DIV', 'P', 'LI'])

const ELEMENT_NODE = 1
const TEXT_NODE = 3

function currentSelection(): Selection | null {
  return typeof document.getSelection === 'function' ? document.getSelection() : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function nodeText(node: Node): string {
  if (node.nodeType === TEXT_NODE) return node.nodeValue ?? ''
  if (node.nodeType !== ELEMENT_NODE) return ''

  const element = node as HTMLElement
  if (element.tagName === 'BR') return '\n'

  const filename = element.getAttribute(MENTION_FILENAME_ATTR)
  if (filename !== null) return `@${filename}`

  const skillName = element.getAttribute(SKILL_NAME_ATTR)
  if (skillName !== null) return `/${skillName}`

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
 * 按标记把文本切成「普通文本 / `@文件名` / `/技能名`」片段。
 *
 * 标记拼写由调用方给出（`mentionToken` / `skillToken` 是唯一来源）；长的优先匹配，
 * 避免 `@a.csv` 把 `@a.csv.bak` 吃掉一半。技能标记作为可选参数，
 * 缺省时行为与只有 `@` 引用时逐字一致（存量调用点无需改动）。
 */
export function splitComposerSegments(
  text: string,
  tokens: readonly string[],
  skillTokens: readonly string[] = [],
): ComposerSegment[] {
  const mentions = [...new Set(tokens.filter((token) => token !== ''))].sort(
    (left, right) => right.length - left.length,
  )
  const skills = [...new Set(skillTokens.filter((token) => token !== ''))].sort(
    (left, right) => right.length - left.length,
  )
  const all = [...mentions, ...skills].sort((left, right) => right.length - left.length)
  if (all.length === 0) return text === '' ? [] : [{ kind: 'text', text }]

  const mentionSet = new Set(mentions)
  const pattern = new RegExp(all.map(escapeRegExp).join('|'), 'g')
  const segments: ComposerSegment[] = []
  let cursor = 0

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) segments.push({ kind: 'text', text: text.slice(cursor, index) })
    segments.push({
      kind: mentionSet.has(match[0]) ? 'mention' : 'skill',
      token: match[0],
    })
    cursor = index + match[0].length
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
  return segments
}
