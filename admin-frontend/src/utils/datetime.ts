/**
 * 时间展示（2026-11-27 收敛）。
 *
 * 后端时间形如 `YYYY-MM-DD HH:mm:ss`（带空格），`new Date()` 在部分引擎里不认，
 * 统一替换为 `T` 再解析；解析失败原样返回，避免界面出现 `Invalid Date`。
 */
export function formatDateTime(value: string): string {
  const date = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

/** 是否已过期（`expires_at` 为空 = 长期有效） */
export function isExpired(expiresAt: string | null, now: number = Date.now()): boolean {
  if (!expiresAt) return false
  const time = new Date(expiresAt.replace(' ', 'T')).getTime()
  return !Number.isNaN(time) && time <= now
}
