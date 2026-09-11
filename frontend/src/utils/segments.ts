/**
 * 内容分段（纯函数）
 *
 * 消息正文按**纯文本**渲染（`white-space: pre-wrap`），不引入 Markdown 库（`research.md` D7）。
 * 本模块一次性把原文切成有序、无重叠的分段数组，模板用 `v-for` 渲染：
 * - `text` → 纯文本
 * - `link` → `<a>`（仅 `http://` / `https://`）
 * - `mark` → `<mark>`（搜索命中，黄色高亮）
 *
 * **可测不变式**：分段按顺序拼接 MUST 能还原原文（不丢字符、不重复）。
 *
 * 链接与高亮的叠加（关键词落在 URL 内）通过**同时**携带 `href` 与 `matchIndex` 表达：
 * `type='mark'` 且存在 `href` 时，渲染为可点击的高亮片段。
 */

/** 分段类型。 */
export type SegmentType = 'text' | 'link' | 'mark'

/** 内容分段。 */
export interface ContentSegment {
  type: SegmentType
  /** 片段文本 */
  text: string
  /** 仅链接（含链接内的高亮片段）：外链地址 */
  href?: string
  /** 仅高亮：全局匹配序号（用于逐次跳转定位） */
  matchIndex?: number
}

/** 链接识别：仅 `http://` / `https://`，遇空白或引号终止。 */
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi

/** 结尾标点（中英文），需从链接尾部剥离。 */
const TRAILING_PUNCTUATION = /[.,;:!?，。；：！？、'"’”]+$/

/** 右括号 → 对应左括号。 */
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

/** 左括号集合。 */
const OPENING_BRACKETS: ReadonlySet<string> = new Set(Object.values(CLOSING_TO_OPENING))

/** 匹配区间（左闭右开）。 */
interface Range {
  start: number
  end: number
  href?: string
}

/**
 * 构建内容分段。
 *
 * @param content 原文
 * @param keyword 搜索关键词（空串表示不做高亮）
 * @param matchIndexBase 该内容内首个命中的**全局**序号（跨消息累计）
 */
export function buildSegments(content: string, keyword = '', matchIndexBase = 0): ContentSegment[] {
  if (content === '') {
    return []
  }

  const linkRanges = findLinkRanges(content)
  const markRanges = findMarkRanges(content, keyword)

  // 以链接与高亮的起止点切分原文，保证分段无重叠且可拼接还原
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

  // 链接与高亮区间均按位置升序且互不重叠 ⇒ 用**单调游标**替代逐段线性扫描，
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

/** 找出全部链接区间（含尾部标点/括号修正）。 */
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
    // 防御零长度匹配导致的死循环
    if (pattern.lastIndex <= match.index) {
      pattern.lastIndex = match.index + 1
    }
    match = pattern.exec(content)
  }

  return ranges
}

/** 找出全部关键词命中区间（大小写不敏感，保留原文大小写）。 */
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

/** 剥离链接尾部不属于地址的标点与不配对的右括号。 */
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

/** 从首个"多余"的右括号处截断（括号在地址内成对出现时保留）。 */
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
