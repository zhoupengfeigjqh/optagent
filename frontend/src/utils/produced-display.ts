/**
 * 后台产出的展示格式化（纯函数，便于单测）
 *
 * 口径与后端 `agent-backend/src/domain/produced.ts` 的 `formatProducedList` / `relativeTime`
 * 以及 `tool-result.ts` 的 `formatBytes` **保持一致**：同一条产出在「提示词清单」与
 * 「铃铛面板」里应给出同样的人类可读描述，否则同一个东西在两处说法不一。
 *
 * 2026-10-09 追加**标题两段**（`producedSummary` / `producedTag`，见各自注释）：
 * 摘要（服务给，可缺省）与标识（平台字段，永不缺省）分开成段，不再拼成一根字符串——
 * 后者排在前面会被单行省略号整段吃掉，等于没显示。
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

/**
 * 中间省略：`ocr_1790123456789_8bcccfd2` → `ocr_17901234…cfd2`。
 *
 * 为什么不用"尾部省略"：标题里标识排在摘要之后，交给 CSS 的单行省略号时被吃掉的
 * **永远是末尾**（`job_id` 正好在最末）——等于白放。故先把中段收掉，两端的
 * 服务前缀与随机后缀都留着，便于人眼比对与复制。
 *
 * 按**码点**切（`Array.from`），不切开 emoji 等代理对；短到不需要省略时原样返回。
 */
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

/**
 * 标题副段（**悬停提示用**）= `工具全名 · job_id`，两个值都保持完整。
 *
 * 与 `producedTag` 的分工：那个是屏幕上那行（中段省略到有界宽度），这个是 `title` 属性，
 * 保证"完整值永远可查"——省略号不该让人拿不到原文。
 */
export function producedTagFull(tool: string, jobId: string): string {
  return `${tagToolName(tool)} · ${jobId}`
}

/**
 * 标题副段（屏幕上那行）= `工具名 · job_id`，两段各自中间省略。
 *
 * 内容**全部来自平台已知字段**（`tool` 由运行环境写、`job_id` 是落盘键），所以
 * 永不缺省、天然唯一：服务不给 `summary` 时，多条产出也**不再长得一模一样**（可对账）。
 * 工具全名可能很长（`{server}__{tool}`），故也收中段——两端的前缀与工具名仍可辨。
 */
export function producedTag(tool: string, jobId: string): string {
  const name = middleEllipsis(tagToolName(tool), 24, 8)
  return `${name} · ${middleEllipsis(jobId, 12, 4)}`
}
