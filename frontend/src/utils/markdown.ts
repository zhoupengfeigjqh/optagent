
export interface Piece {
  text: string
  start: number
}

export type InlineKind = 'text' | 'code' | 'strong' | 'em' | 'link' | 'red'

export interface InlineRun extends Piece {
  kind: InlineKind
  href?: string
}

export type MarkdownBlock =
  | { kind: 'paragraph'; start: number; runs: InlineRun[] }
  | { kind: 'heading'; start: number; level: number; runs: InlineRun[] }
  | { kind: 'list'; start: number; ordered: boolean; items: InlineRun[][] }
  | { kind: 'quote'; start: number; runs: InlineRun[] }
  | { kind: 'code'; start: number; language: string; piece: Piece }
  | { kind: 'table'; start: number; header: InlineRun[][]; rows: InlineRun[][][] }
  | { kind: 'rule'; start: number }

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

const INLINE =
  /(`[^`\n]+`)|(==\S(?:[^\n=]*?\S)?==)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]*\]\([^)\s]*\))/g

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
    if (
      line.text.includes('|') &&
      index + 1 < lines.length &&
      isDividerRow(lines[index + 1].text)
    ) {
      const header = parseCells(lines[index])
      index += 2
      const rows: InlineRun[][][] = []
      while (
        index < lines.length &&
        lines[index].text.trim() !== '' &&
        lines[index].text.includes('|')
      ) {
        rows.push(parseCells(lines[index]))
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

    const paragraph: SourceLine[] = []
    while (index < lines.length && lines[index].text.trim() !== '' && !startsBlock(lines, index)) {
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
      runs.push({ kind: 'red', text: raw.slice(2, -2), start: offset + 2 })
    } else if (matched[3] !== undefined) {
      runs.push({ kind: 'strong', text: raw.slice(2, -2), start: offset + 2 })
    } else if (matched[4] !== undefined) {
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

function startsBlock(lines: SourceLine[], index: number): boolean {
  const text = lines[index].text
  if (FENCE.test(text) || RULE.test(text) || HEADING.test(text) || QUOTE.test(text)) return true
  if (BULLET.test(text) || ORDERED.test(text)) return true
  return text.includes('|') && index + 1 < lines.length && isDividerRow(lines[index + 1].text)
}

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

function isFenceClose(text: string, marker: string): boolean {
  const trimmed = text.trim()
  return trimmed.length >= 3 && trimmed.split('').every((char) => char === marker)
}

function isDividerRow(text: string): boolean {
  const cells = splitCells({ text, start: 0 }).map((cell) => cell.text)
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell))
}

function parseCells(line: SourceLine): InlineRun[][] {
  return splitCells(line).map((cell) => parseInline(cell.text, cell.start))
}

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
