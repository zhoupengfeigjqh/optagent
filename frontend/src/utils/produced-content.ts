/**
 * 产出正文的**展示解析**（纯函数，便于单测）。
 *
 * 只做三件事：
 * 1. 判断正文能否当 JSON **结构化展示**（对象 / 数组）；
 * 2. 对"太大 / 不是 JSON / 只是标量"给出**可读的降级原因**（界面据此回落 `<pre>` 原样展示）；
 * 3. 给结构化渲染提供表格列（对象数组的键并集）。
 *
 * 与 `produced-display.ts` 分工：那里格式化**元数据**（时间/体积/角标），这里只管**正文**。
 *
 * **平台仍不解析正文**（契约 §10.3）：这里是**前端展示层**的选择——服务端存储、投影、
 * 提示词注入一字不变；解析只为"看得清 + 能一键切回原文"，不参与任何业务判读。
 *
 * `isPlainObject` 复用 `arg-schema.ts` 的实现：它是通用的"普通对象"判据，
 * 与该模块的 HITL 语义无关，重复定义只会多一处漂移点。
 */
import { isPlainObject } from './arg-schema'

/**
 * 超过该**字符数**的正文不尝试解析——避免大文本阻塞主线程。
 *
 * 用字符数而非严格字节数（`TextEncoder` 要为最大 10MB 的正文额外分配一份缓冲）：
 * UTF-8 下字节数恒 ≥ 字符数，故该阈值**只会更宽松地放行**，作为"防卡顿"的经验值足够。
 */
export const PRODUCED_JSON_MAX_CHARS = 256 * 1024

/** 结构化渲染时单个数组最多渲染的元素数（超出只提示总数，不渲染）。 */
export const PRODUCED_ARRAY_MAX_ITEMS = 100

/**
 * 结构化渲染的最大嵌套深度（超出交 JSON 逃生舱）。
 *
 * 防病态结构（如自引用的深链）把界面拖死；正常产出远深不到这里。
 */
export const PRODUCED_JSON_MAX_DEPTH = 8

/** 降级原因（界面据此决定是否给提示；`''` = 可结构化，无需提示）。 */
export type ProducedFallbackReason = 'too_large' | 'invalid' | 'scalar' | 'empty' | ''

export interface ProducedContentParse {
  /** `true` = 可结构化展示（此时 `value` 是对象或数组） */
  structured: boolean
  /** 解析后的值；不可结构化时恒为 `null` */
  value: unknown
  /** 不可结构化的判据 */
  reason: ProducedFallbackReason
}

/**
 * 解析产出正文。
 *
 * - 空白（含 `null`）→ `empty`
 * - 超过 `maxChars` → **不解析**，直接 `too_large`
 * - 不是合法 JSON → `invalid`
 * - 是 JSON 但是**标量**（数字/字符串/布尔/null）→ `scalar`（原样展示比包一层更直观）
 * - 是 JSON 对象 / 数组 → `structured: true`
 *
 * 一切失败都**不抛异常**：这是展示层，必须总能回落原文（`<pre>`）。
 */
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

/**
 * 对象数组的**表格列**：各元素出现过的键的并集（按首次出现顺序）。
 *
 * 产出正文没有 schema（不像 HITL 表单由 `inputSchema` 决定列），列只能**从值里推**。
 * 非对象元素被跳过——调用方已保证"全是对象"才走表格。
 */
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
