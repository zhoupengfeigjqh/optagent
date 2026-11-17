/**
 * 粘贴待发文件的「预演命名」（2026-11-17，023 v1.3）
 *
 * 粘贴**不落盘**，所以"最终叫什么"只能等到发送那一刻才知道：那时才有目录清单可比。
 * 但气泡里必须显示真名，于是发送前先在前端算一个候选名，作为上传请求的 filename 传过去。
 *
 * **唯一权威仍是后端**（`agent-backend/src/domain/upload-name.ts` 的 `claimName`）：
 * 它用 `link`/`COPYFILE_EXCL` 原子占名，撞上就换下一个编号。本模块只是**预演**，
 * 结果永远被服务端响应里的 `filename` 覆盖——两处不一致时以服务端为准，界面不会说谎。
 *
 * 规则与后端逐字对齐（改一处必须同改另一处，口径见 023 spec 的风险登记）：
 * - 不重名用原名；重名 `主名(n)扩展名`，**半角括号**、紧贴主名、编号在扩展名前、从 1 起；
 * - `a.tar.gz` ⇒ `a.tar(1).gz`，`README` ⇒ `README(1)`，`.env` ⇒ `.env(1)`；
 * - 比对**大小写不敏感**（Windows/macOS 语义）：在大小写敏感的 Linux 上只会更保守，
 *   多改一次名但不会真的冲突。
 */

/** 候选名尝试上限（与后端 `MAX_NAME_ATTEMPTS` 对齐）：用尽即退化为下一个编号，不做无限重试 */
export const MAX_NAME_ATTEMPTS = 999

/** 主名保留的最大**字符**数（与后端 `MAX_BASE_CHARS` 对齐）：给编号与扩展名留位 */
export const MAX_BASE_CHARS = 200

/** 主名 / 扩展名切分：口径与 `node:path` 的 `extname` 一致（`.env` 没有扩展名） */
export function splitName(original: string): { stem: string; ext: string } {
  const base = original.replace(/[/\\]/g, '_')
  const dot = base.lastIndexOf('.')
  if (dot <= 0) {
    return { stem: base === '' ? 'file' : base, ext: '' }
  }
  return { stem: base.slice(0, dot), ext: base.slice(dot) }
}

/** 按**码点**截断主名，给编号与扩展名留位（不切开代理对） */
function clampStem(stem: string, suffix: string): string {
  const chars = Array.from(stem)
  const limit = Math.max(1, MAX_BASE_CHARS - Array.from(suffix).length)
  return chars.length <= limit ? stem : chars.slice(0, limit).join('')
}

/**
 * 第 `index` 个候选名：`0` ⇒ 原名；`n` ⇒ `主名(n)扩展名`。
 *
 * 编号只出现在主名与扩展名之间，保证 `a.tar.gz` ⇒ `a.tar(1).gz`。
 */
export function candidateName(original: string, index: number): string {
  const { stem, ext } = splitName(original)
  const suffix = index <= 0 ? '' : `(${index})`
  return `${clampStem(stem, `${suffix}${ext}`)}${suffix}${ext}`
}

/**
 * 在 `taken`（**小写**文件名集合）里为 `original` 找一个可用名，并把结果写回 `taken`。
 *
 * 调用方用同一个 `taken` 连续分配，即可同时消解"与已有文件重名"和"同一批内部重名"。
 */
export function allocateName(
  original: string,
  taken: Set<string>,
  maxAttempts: number = MAX_NAME_ATTEMPTS,
): string {
  for (let index = 0; index <= maxAttempts; index += 1) {
    const name = candidateName(original, index)
    const key = name.toLowerCase()
    if (taken.has(key)) continue
    taken.add(key)
    return name
  }
  // 候选名用尽（同名文件上千个）：不抛错把发送打断，退化为下一号——服务端仍会兜底改名
  const fallback = candidateName(original, maxAttempts + 1)
  taken.add(fallback.toLowerCase())
  return fallback
}
