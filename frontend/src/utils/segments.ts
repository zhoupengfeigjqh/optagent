
export type SegmentType = 'text' | 'link' | 'mark'

export interface ContentSegment {
  type: SegmentType
  text: string
  href?: string
  matchIndex?: number
}

export interface MatchRange {
  start: number
  end: number
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi

const TRAILING_PUNCTUATION = /[.,;:!?，。；：！？、'"’”]+$/

const CLOSING_TO_OPENING: Readonly<Record<string, string>> = {
  ')': '(',
  '）': '（',
  ']': '[',
  '】': '[',
  '}': '{',
  '》': '<',
  '」': '「',
  '』': '『',
}

const OPENING_BRACKETS: ReadonlySet<string> = new Set(Object.values(CLOSING_TO_OPENING))

interface Range {
  start: number
  end: number
  href?: string
}

export function buildSegments(content: string, keyword = '', matchIndexBase = 0): ContentSegment[] {
  if (content === '') {
    return []
  }

  const linkRanges = findLinkRanges(content)
  const markRanges = findMarkRanges(content, keyword)

  const boundaries = new Set<number>([0, content.length])
  for (const range of linkRanges) {
    boundaries.add(range.start)
    boundaries.add(range.end)
  }
  for (const range of markRanges) {
    boundaries.add(range.start)
    boundaries.add(range.end)
  }

  const points = [...boundaries].sort((a, b) => a - b)
  const segments: ContentSegment[] = []

  // 避免命中密集时退化为 O(分段数 × 命中数)（宪章原则五：渲染路径不得有昂贵计算）
  let linkCursor = 0
  let markCursor = 0

  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i]
    const end = points[i + 1]
    if (start >= end) {
      continue
    }

    while (linkCursor < linkRanges.length && linkRanges[linkCursor].end <= start) {
      linkCursor += 1
    }
    while (markCursor < markRanges.length && markRanges[markCursor].end <= start) {
      markCursor += 1
    }

    const linkRange = linkRanges[linkCursor]
    const markRange = markRanges[markCursor]
    const link =
      linkRange && linkRange.start <= start && linkRange.end >= end ? linkRange : undefined
    const markIndex =
      markRange && markRange.start <= start && markRange.end >= end ? markCursor : -1

    const segment: ContentSegment = {
      type: markIndex >= 0 ? 'mark' : link ? 'link' : 'text',
      text: content.slice(start, end),
    }
    if (link) {
      segment.href = link.href
    }
    if (markIndex >= 0) {
      segment.matchIndex = matchIndexBase + markIndex
    }

    appendSegment(segments, segment)
  }

  return segments
}

/**
 * 统计关键词在正文中的命中次数。
 *
 * 与 `buildSegments` 的高亮口径**必须一致**（同一匹配语义），
 * 供 `useSessionSearch` 计算匹配总数与逐条基准序号。
 */
export function countMatches(content: string, keyword: string): number {
  return findMarkRanges(content, keyword).length
}

/**
 * 找出全部关键词命中区间（升序）。
 *
 * 与 `buildSegments` 的高亮**同源**（同一套匹配语义）——Markdown 渲染侧需要
 * "某片段之前已有多少个命中"来换算全局序号，故把区间本身暴露出去，
 * 避免两边各写一套正则、序号悄悄漂移（`MessageContent` 依赖这个口径）。
 */
export function findMatches(content: string, keyword: string): MatchRange[] {
  return findMarkRanges(content, keyword).map((range) => ({ start: range.start, end: range.end }))
}

/** 追加分段；与上一段类型/链接/序号完全一致时合并，避免碎片化 DOM。 */
function appendSegment(segments: ContentSegment[], segment: ContentSegment): void {
  const previous = segments[segments.length - 1]
  if (
    previous &&
    previous.type === segment.type &&
    previous.href === segment.href &&
    previous.matchIndex === segment.matchIndex
  ) {
    previous.text += segment.text
    return
  }
  segments.push(segment)
}

function findLinkRanges(content: string): Range[] {
  const ranges: Range[] = []
  const pattern = new RegExp(URL_PATTERN.source, 'gi')

  let match = pattern.exec(content)
  while (match !== null) {
    const raw = match[0]
    const href = trimUrlTail(raw)
    if (href.length > 0) {
      ranges.push({ start: match.index, end: match.index + href.length, href })
    }
    if (pattern.lastIndex <= match.index) {
      pattern.lastIndex = match.index + 1
    }
    match = pattern.exec(content)
  }

  return ranges
}

function findMarkRanges(content: string, keyword: string): Range[] {
  const trimmed = keyword.trim()
  if (trimmed === '') {
    return []
  }

  const ranges: Range[] = []
  const pattern = new RegExp(escapeRegExp(trimmed), 'gi')

  let match = pattern.exec(content)
  while (match !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex += 1
      continue
    }
    ranges.push({ start: match.index, end: match.index + match[0].length })
    match = pattern.exec(content)
  }

  return ranges
}

function trimUrlTail(raw: string): string {
  let url = raw
  for (let guard = 0; guard < 64; guard += 1) {
    const withoutBrackets = trimUnbalancedTail(url)
    const withoutPunctuation = withoutBrackets.replace(TRAILING_PUNCTUATION, '')
    if (withoutPunctuation === url || withoutPunctuation === '') {
      return url
    }
    url = withoutPunctuation
  }
  return url
}

function trimUnbalancedTail(url: string): string {
  const stack: string[] = []
  for (let i = 0; i < url.length; i += 1) {
    const char = url[i]
    const opening = CLOSING_TO_OPENING[char]
    if (opening !== undefined) {
      if (stack.length === 0) {
        return url.slice(0, i)
      }
      stack.pop()
    } else if (OPENING_BRACKETS.has(char)) {
      stack.push(char)
    }
  }
  return url
}

/** 转义正则元字符，避免关键词被当作模式解释。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
