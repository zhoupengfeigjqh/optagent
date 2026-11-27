import { isPlainObject } from './arg-schema'

/**
 * 超过该**字符数**的正文不尝试解析——避免大文本阻塞主线程。
 *
 * 用字符数而非严格字节数（`TextEncoder` 要为最大 10MB 的正文额外分配一份缓冲）：
 * UTF-8 下字节数恒 ≥ 字符数，故该阈值**只会更宽松地放行**，作为"防卡顿"的经验值足够。
 */
export const PRODUCED_JSON_MAX_CHARS = 256 * 1024

export const PRODUCED_ARRAY_MAX_ITEMS = 10

export const PRODUCED_TABLE_MAX_COLUMNS = 50

export const PRODUCED_JSON_MAX_DEPTH = 8

/** 降级原因（界面据此决定是否给提示；`''` = 可结构化，无需提示）。 */
export type ProducedFallbackReason = 'too_large' | 'invalid' | 'scalar' | 'empty' | ''

export interface ProducedContentParse {
  structured: boolean
  /** 解析后的值；不可结构化时恒为 `null` */
  value: unknown
  /** 不可结构化的判据 */
  reason: ProducedFallbackReason
}

export function parseProducedContent(
  text: string | null,
  maxChars: number = PRODUCED_JSON_MAX_CHARS,
): ProducedContentParse {
  const raw = text ?? ''
  if (raw.trim() === '') return { structured: false, value: null, reason: 'empty' }
  if (raw.length > maxChars) return { structured: false, value: null, reason: 'too_large' }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { structured: false, value: null, reason: 'invalid' }
  }
  if (!isPlainObject(value) && !Array.isArray(value)) {
    return { structured: false, value: null, reason: 'scalar' }
  }
  return { structured: true, value, reason: '' }
}

/**
 * 降级原因 → 界面提示文案（`''` = 不提示）。
 *
 * 只有 `too_large` 需要解释——用户会疑惑"为什么这条不能结构化"；
 * 其余（不是 JSON、是标量）"原样展示"本就是预期行为，多一句提示只是噪声。
 */
export function fallbackHint(reason: ProducedFallbackReason): string {
  if (reason !== 'too_large') return ''
  return `内容较大（超过 ${Math.floor(PRODUCED_JSON_MAX_CHARS / 1024)}K 字符），已按原始文本展示。`
}

export function columnsOfRows(rows: readonly unknown[]): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!isPlainObject(row)) continue
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue
      seen.add(key)
      keys.push(key)
    }
  }
  return keys
}
