/**
 * 后台产出的展示格式化（纯函数，便于单测）
 *
 * 口径与后端 `agent-backend/src/domain/produced.ts` 的 `formatProducedList` / `relativeTime`
 * 以及 `tool-result.ts` 的 `formatBytes` **保持一致**：同一条产出在「提示词清单」与
 * 「铃铛面板」里应给出同样的人类可读描述，否则同一个东西在两处说法不一。
 */

/** 相对时间：与后端同档位（刚刚 / N 分钟前 / N 小时前 / N 天前） */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return '时间未知'
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/**
 * 绝对时间（**本地时区**）：`YYYY-MM-DD HH:mm:ss`。
 *
 * 与 `relativeTime` 分工：相对时间回答"多久前"，绝对时间回答"具体哪一刻"。
 * 铃铛需要**创建与完成两个时刻**，相对时间给不出先后与跨天信息。
 * 无法解析给可读占位，不留空白（与 `relativeTime` 同口径）。
 */
export function formatDateTime(iso: string): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return '时间未知'
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

/** 人类可读体积（B / KB / MB），与后端 `formatBytes` 同档 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 拆产出路径（`临时空间/后台产出/th_1_j_2.txt`）→ 预览接口要的 `dir` + `filename`。
 *
 * 无分隔符时 `dir` 为空串——刻意**不猜**：让预览接口按自己的口径报可读错误，
 * 好过前端拼出一个必然错的路径。
 */
export function splitProducedPath(relPath: string): { dir: string; filename: string } {
  const idx = relPath.lastIndexOf('/')
  return idx === -1
    ? { dir: '', filename: relPath }
    : { dir: relPath.slice(0, idx), filename: relPath.slice(idx + 1) }
}

/** 未读角标文案：超过 99 显示 `99+`，避免角标被长数字撑破 */
export function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count)
}
