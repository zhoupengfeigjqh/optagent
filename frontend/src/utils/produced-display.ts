
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

export function middleEllipsis(text: string, head = 12, tail = 4): string {
  const chars = Array.from(text)
  if (chars.length <= head + tail + 1) return text
  return `${chars.slice(0, head).join('')}…${chars.slice(-tail).join('')}`
}

/**
 * 标题主段 = 一行摘要：优先服务提供的 `summary`；缺省时给**可读兜底**。
 *
 * MUST NOT 回落成落盘文件名（`{会话UUID}_{job_id}`，纯机读）——2026-09-25 实测反馈。
 */
export function producedSummary(summary: string | undefined): string {
  const text = summary?.trim() ?? ''
  return text === '' ? '后台任务结果（该任务未提供摘要）' : text
}

/** 标识段的工具名：缺省给可读兜底（与元信息行同口径），不留白 */
function tagToolName(tool: string): string {
  const name = tool.trim()
  return name === '' ? '未知工具' : name
}

export function producedTagFull(tool: string, jobId: string): string {
  return `${tagToolName(tool)} · ${jobId}`
}

export function producedTag(tool: string, jobId: string): string {
  const name = middleEllipsis(tagToolName(tool), 24, 8)
  return `${name} · ${middleEllipsis(jobId, 12, 4)}`
}
