/**
 * 展示格式化（纯函数）
 *
 * 耗时统一格式化为 **1 位小数**（`contracts/backend-api.md` §7 差异 4）：
 * 后端 `duration_seconds` 由 `Math.round(ms) / 1000` 得出，精度最多 3 位小数，前端不依赖其精度。
 */

import type { Usage } from '../api/types'

/** 格式化用量：`输入 10 · 输出 5 tokens`；无数据返回空串（调用方据此不渲染）。 */
export function formatTokens(usage: Usage | null | undefined): string {
  if (!usage || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens)) {
    return ''
  }
  return `输入 ${usage.input_tokens} · 输出 ${usage.output_tokens} tokens`
}

/** 格式化耗时：保留 1 位小数并追加 `s`（如 `4.2s`）；无数据返回空串。 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return ''
  }
  return `${seconds.toFixed(1)}s`
}

/** 格式化文件大小：`B` / `KB` / `MB`，保留 1 位小数；非法输入返回空串。 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return ''
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 格式化时间戳为本地时间 `YYYY-MM-DD HH:mm`。
 *
 * 不使用 `toLocaleString`，以保证输出稳定可断言（避免不同运行环境的区域差异）。
 */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) {
    return ''
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const ymd = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0'))
    .join('-')
  const hm = [date.getHours(), date.getMinutes()]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
  return `${ymd} ${hm}`
}
