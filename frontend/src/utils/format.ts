
import type { Usage } from '../api/types'

export function formatTokens(usage: Usage | null | undefined): string {
  if (!usage || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens)) {
    return ''
  }
  return `输入 ${usage.input_tokens} · 输出 ${usage.output_tokens} tokens`
}

export function formatDurationSec(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return ''
  }
  return `${seconds.toFixed(1)}s`
}

/** 耗时（**毫秒**，工具调用用时）：`84ms` / `1.6s`；非法返回空串。 */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return ''
  }
  // 先取整再分段：999.6ms 取整后是 1000，直接按毫秒输出会得到奇怪的 `1000ms`
  const rounded = Math.round(ms)
  if (rounded < 1000) return `${rounded}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatMinutesCompact(
  minutes: number | string | null | undefined,
  fallback = '--',
): string {
  if (minutes === null || minutes === undefined || minutes === '') {
    return fallback
  }
  const value = Number(minutes)
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }
  let hours = Math.floor(value / 60)
  let rest = Math.round(value % 60)
  // 四舍五入可能把余数顶到 60（如 119.6 分钟）：进位到小时，避免出现 `1h60min`
  if (rest === 60) {
    hours += 1
    rest = 0
  }
  if (hours <= 0) return `${rest}min`
  return rest > 0 ? `${hours}h${rest}min` : `${hours}h`
}

/**
 * 体积（**字节**）：`B` / `KB` / `MB`，保留 1 位小数。
 *
 * @param fallback 非法或负数时的替代文本：文件列表用 `''`（整段不渲染），
 *   产出面板用 `'—'`（表格占位不留白）。
 */
export function formatBytes(bytes: number | null | undefined, fallback = ''): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return fallback
  }
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 时间戳 → 本地 `YYYY-MM-DD HH:mm`（`withSeconds` 时追加 `:ss`）。
 *
 * 不使用 `toLocaleString`，以保证输出稳定可断言（避免不同运行环境的区域差异）。
 * `fallback` 语义同 `formatBytes`：链接类场景给 `''`，铃铛面板给 `'时间未知'`。
 */
export function formatTimestamp(
  iso: string | null | undefined,
  opts: { withSeconds?: boolean; fallback?: string } = {},
): string {
  const { withSeconds = false, fallback = '' } = opts
  if (!iso) {
    return fallback
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return fallback
  }
  const ymd = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0'))
    .join('-')
  const hms = [date.getHours(), date.getMinutes(), ...(withSeconds ? [date.getSeconds()] : [])]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
  return `${ymd} ${hms}`
}
