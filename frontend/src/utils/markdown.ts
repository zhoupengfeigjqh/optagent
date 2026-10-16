/**
 * 最小 Markdown 子集解析（纯函数，2026-10-16）。
 *
 * 为什么自研而不引库：① 宪章原则六（依赖治理）——渲染器 + XSS 净化器是**两个**新依赖，
 * 要把评审走一遍；② 本项目的既有风格就是零第三方（图标、分段、文件类型全都自研）；
 * ③ agent 的输出高度收敛：标题、列表、表格、代码块、引用、粗体/斜体、行内代码、链接。
 * 其余语法（嵌套列表、图片、HTML、脚注、`_` 斜体）**原样当文本输出**——宁可少渲染，
 * 不可渲染错，更不可引入注入面。
 *
 * **可测不变式**：解析只丢掉"标记本身"，不改变正文可见字符的顺序；每个可高亮片段都带
 * `start`（在原文中的起始偏移），供搜索高亮换算全局命中序号
 * （见 `components/chat/MessageContent.vue`）。
 *
 * 已知取舍（有用例钉住，免后来者当 bug 修）：命中若落在被丢掉的标记里（例如搜索 `**`、
 * `---`、`# `），`useSessionSearch` 仍会按**原文**计数，但页面上没有可高亮的节点。
 *
 * 安全：链接只放行 `http(s)://` 与站内绝对路径；`javascript:` 之类的伪协议一律退化为
 * 普通文本（否则"渲染增强"就变成注入面，宪章原则四/九）。
 */

/** 可高亮片段：文本 + 在原文中的起始偏移 */
export interface Piece {
  text: string
  start: number
}

/** 行内片段类型 */
export type InlineKind = 'text' | 'code' | 'strong' | 'em' | 'link'

/** 行内片段（`text` 片段之外的种类渲染成对应的行内元素） */
export interface InlineRun extends Piece {
  kind: InlineKind
  /** 仅链接：目标地址（已校验） */
  href?: string
}

/** 块级节点 */
export type MarkdownBlock =
  | { kind: 'paragraph'; start: number; runs: InlineRun[] }
  | { kind: 'heading'; start: number; level: number; runs: InlineRun[] }
  | { kind: 'list'; start: number; ordered: boolean; items: InlineRun[][] }
  | { kind: 'quote'; start: number; runs: InlineRun[] }
  | { kind: 'code'; start: number; language: string; piece: Piece }
  | { kind: 'table'; start: number; header: Piece[]; rows: Piece[][] }
  | { kind: 'rule'; start: number }

/** 带原文偏移的一行 */
interface SourceLine {
  text: string
  start: number
}

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const QUOTE = /^\s*>\s?(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+(.*)$/

/**
 * 行内标记。**顺序即优先级**：`**` 必须排在 `*` 前面，否则粗体会被吃成"斜体 + 残留星号"。
 * 刻意不支持 `_` 变体：本项目的正文里 `snake_case` 标识符很常见，误判代价高于收益。
 */
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]*\]\([^)\s]*\))/g

/** 解析正文为块级序列 */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = splitLines(source)
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line.text.trim() === '') {
      index += 1
      continue
    }

    // 围栏代码块：收尾围栏缺失（流式中途）时吃到文末
    const fence = FENCE.exec(line.text)
    if (fence) {
      const marker = fence[1][0]
      const bodyStart = line.start + line.text.length + 1
      index += 1
      const body: string[] = []
      while (index < lines.length && !isFenceClose(lines[index].text, marker)) {
        body.push(lines[index].text)
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      blocks.push({
        kind: 'code',
        start: line.start,
        language: fence[2] ?? '',
        piece: { text: body.join('\n'), start: bodyStart },
      })
      continue
    }

    if (RULE.test(line.text)) {
      blocks.push({ kind: 'rule', start: line.start })
      index += 1
      continue
    }

    const heading = HEADING.exec(line.text)
    if (heading) {
      const contentStart = line.start + heading[1].length + 1
      blocks.push({
        kind: 'heading',
        start: line.start,
        level: heading[1].length,
        runs: parseInline(heading[2], contentStart),
      })
      index += 1
      continue
    }

    // 表格：本行有 `|` 且**下一行是分隔行**，才敢认定（否则普通含竖线的句子会被误判）
    if (line.text.includes('|') && index + 1 < lines.length && isDividerRow(lines[index + 1].text)) {
      const header = splitCells(lines[index])
      index += 2
      const rows: Piece[][] = []
      while (
        index < lines.length &&
        lines[index].text.trim() !== '' &&
        lines[index].text.includes('|')
      ) {
        rows.push(splitCells(lines[index]))
        index += 1
      }
      blocks.push({ kind: 'table', start: line.start, header, rows })
      continue
    }

    if (QUOTE.test(line.text)) {
      const quoted: SourceLine[] = []
      while (index < lines.length) {
        const matched = QUOTE.exec(lines[index].text)
        if (!matched) break
        quoted.push({
          text: matched[1],
          start: lines[index].start + lines[index].text.length - matched[1].length,
        })
        index += 1
      }
      blocks.push({ kind: 'quote', start: line.start, runs: joinLines(quoted) })
      continue
    }

    const bullet = BULLET.exec(line.text)
    const numbered = bullet ? null : ORDERED.exec(line.text)
    if (bullet || numbered) {
      const ordered = bullet === null
      const items: InlineRun[][] = []
      while (index < lines.length) {
        const pattern = ordered ? ORDERED : BULLET
        const matched = pattern.exec(lines[index].text)
        if (!matched) break
        const contentStart = lines[index].start + lines[index].text.length - matched[1].length
        items.push(parseInline(matched[1], contentStart))
        index += 1
      }
      blocks.push({ kind: 'list', start: line.start, ordered, items })
      continue
    }

    // 段落：连续非空行，遇到任何块级起始行即止
    const paragraph: SourceLine[] = []
    while (
      index < lines.length &&
      lines[index].text.trim() !== '' &&
      !startsBlock(lines, index)
    ) {
      paragraph.push(lines[index])
      index += 1
    }
    if (paragraph.length === 0) {
      // 理论上不可达（上面的分支已覆盖全部起始行），但空转会造成死循环，故兜底成一行文本
      paragraph.push(line)
      index += 1
    }
    blocks.push({ kind: 'paragraph', start: line.start, runs: joinLines(paragraph) })
  }

  return blocks
}

/** 解析一行内的行内片段 */
export function parseInline(text: string, start: number): InlineRun[] {
  const runs: InlineRun[] = []
  const pattern = new RegExp(INLINE.source, 'g')
  let cursor = 0
  let matched = pattern.exec(text)

  while (matched !== null) {
    if (matched.index > cursor) {
      runs.push({
        kind: 'text',
        text: text.slice(cursor, matched.index),
        start: start + cursor,
      })
    }

    const raw = matched[0]
    const offset = start + matched.index
    if (matched[1] !== undefined) {
      runs.push({ kind: 'code', text: raw.slice(1, -1), start: offset + 1 })
    } else if (matched[2] !== undefined) {
      runs.push({ kind: 'strong', text: raw.slice(2, -2), start: offset + 2 })
    } else if (matched[3] !== undefined) {
      runs.push({ kind: 'em', text: raw.slice(1, -1), start: offset + 1 })
    } else {
      runs.push(parseLink(raw, offset) ?? { kind: 'text', text: raw, start: offset })
    }

    cursor = matched.index + raw.length
    matched = pattern.exec(text)
  }

  if (cursor < text.length) {
    runs.push({ kind: 'text', text: text.slice(cursor), start: start + cursor })
  }

  return runs
}

/** `[标签](地址)` → 链接片段；协议不可信或格式不全时返回 `null`（交给调用方退化处理） */
function parseLink(raw: string, offset: number): InlineRun | null {
  const parts = /^\[([^\]]*)\]\(([^)\s]*)\)$/.exec(raw)
  if (!parts) return null

  const href = parts[2].trim()
  if (!/^https?:\/\//i.test(href) && !href.startsWith('/')) return null

  return { kind: 'link', text: parts[1], start: offset + 1, href }
}

/** 一行是否开启新的块级结构（段落收集时用作终止条件） */
function startsBlock(lines: SourceLine[], index: number): boolean {
  const text = lines[index].text
  if (FENCE.test(text) || RULE.test(text) || HEADING.test(text) || QUOTE.test(text)) return true
  if (BULLET.test(text) || ORDERED.test(text)) return true
  return text.includes('|') && index + 1 < lines.length && isDividerRow(lines[index + 1].text)
}

/** 多行合并成一段：行与行之间补一个 `'\n'` 文本片段，偏移按原文换算 */
function joinLines(lines: SourceLine[]): InlineRun[] {
  const runs: InlineRun[] = []
  lines.forEach((line, index) => {
    if (index > 0) {
      runs.push({ kind: 'text', text: '\n', start: Math.max(line.start - 1, 0) })
    }
    runs.push(...parseInline(line.text, line.start))
  })
  return runs
}

/** 按行切开（保留每行的原文起始偏移，`\r\n` 归一为 `\n`） */
function splitLines(source: string): SourceLine[] {
  const lines: SourceLine[] = []
  let start = 0
  for (let index = 0; index <= source.length; index += 1) {
    if (index === source.length || source[index] === '\n') {
      lines.push({ text: source.slice(start, index).replace(/\r$/, ''), start })
      start = index + 1
    }
  }
  return lines
}

/** 是否为代码块收尾围栏（同种字符、不少于 3 个） */
function isFenceClose(text: string, marker: string): boolean {
  const trimmed = text.trim()
  return trimmed.length >= 3 && trimmed.split('').every((char) => char === marker)
}

/** 是否为表格的分隔行（`| --- | :--: |`） */
function isDividerRow(text: string): boolean {
  const cells = splitCells({ text, start: 0 }).map((cell) => cell.text)
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell))
}

/** 拆单元格（保留每格在原文中的偏移，供高亮换算） */
function splitCells(line: SourceLine): Piece[] {
  const text = line.text
  let from = 0
  let to = text.length

  while (from < to && isSpace(text[from])) from += 1
  if (text[from] === '|') from += 1
  while (to > from && isSpace(text[to - 1])) to -= 1
  if (text[to - 1] === '|') to -= 1

  const cells: Piece[] = []
  let cursor = from
  for (let index = from; index <= to; index += 1) {
    if (index !== to && text[index] !== '|') continue
    let head = cursor
    let tail = index
    while (head < tail && isSpace(text[head])) head += 1
    while (tail > head && isSpace(text[tail - 1])) tail -= 1
    cells.push({ text: text.slice(head, tail), start: line.start + head })
    cursor = index + 1
  }
  return cells
}

function isSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\t'
}
