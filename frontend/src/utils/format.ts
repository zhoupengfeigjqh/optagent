/**
 * 展示格式化（纯函数）——**全站唯一的格式化实现**。
 *
 * 2026-10-27 收敛：此前同一个"千字节/毫秒/时间戳"能力散落在 4 个文件里各自实现
 * （`utils/tool-calls`、`utils/produced-display`、`views/datapage/task-result.data`、
 * 本文件），且有三处**同名不同单位**——`formatDuration` 一处吃秒、一处吃毫秒、
 * 一处吃分钟：IDE 自动导入出错时不会有任何报错，只会显示"84.0s""135.0s"这种荒谬文案。
 * 现在：
 * - 每个能力只有一份实现，函数名**显式带单位**（`Sec` / `Ms` / `Minutes` / `Bytes`）；
 * - 非法输入统一走 `fallback`，调用方按场景给 `''`（整段不渲染）或 `'—'` / `'--'`
 *   （表格占位不留白）或 `'时间未知'`。
 *
 * 耗时统一 1 位小数（`contracts/backend-api.md` §7 差异 4）：后端 `duration_seconds`
 * 由 `Math.round(ms) / 1000` 得出，精度最多 3 位，前端不依赖其精度。
 */

import type { Usage } from '../api/types'

/** 格式化用量：`输入 10 · 输出 5 tokens`；无数据返回空串（调用方据此不渲染）。 */
export function formatTokens(usage: Usage | null | undefined): string {
  if (!usage || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens)) {
    return ''
  }
  return `输入 ${usage.input_tokens} · 输出 ${usage.output_tokens} tokens`
}

/** 耗时（**秒**）：1 位小数 + `s`（如 `4.2s`）；非法返回空串。 */
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

/**
 * 时长（**分钟**，紧凑工时写法）：`45min` / `2h15min`；非正数或非法返回 `fallback`。
 *
 * 与 `formatDurationSec` 分开的原因是真实踩过：排产结果的 `totalDurationMinutes`
 * 是**分钟**，曾经直接喂给吃秒的实现，界面把 135 分钟显示成 `135.0s`。
 * `fallback` 默认 `'--'`：排产指标卡是固定格子，留白会让整行错位。
 *
 * 入参允许**数字字符串**：排产指标载荷是 `Record<string, string | number>`（后端有的字段给
 * 数字、有的给字符串），逐年 `Number` 归一比在调用点各写一次 `Number(...)` 更不易漏。
 */
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
