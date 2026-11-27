
/** 候选名尝试上限（与后端 `MAX_NAME_ATTEMPTS` 对齐）：用尽即退化为下一个编号，不做无限重试 */
export const MAX_NAME_ATTEMPTS = 999

export const MAX_BASE_CHARS = 200

export function splitName(original: string): { stem: string; ext: string } {
  const base = original.replace(/[/\\]/g, '_')
  const dot = base.lastIndexOf('.')
  if (dot <= 0) {
    return { stem: base === '' ? 'file' : base, ext: '' }
  }
  return { stem: base.slice(0, dot), ext: base.slice(dot) }
}

function clampStem(stem: string, suffix: string): string {
  const chars = Array.from(stem)
  const limit = Math.max(1, MAX_BASE_CHARS - Array.from(suffix).length)
  return chars.length <= limit ? stem : chars.slice(0, limit).join('')
}

export function candidateName(original: string, index: number): string {
  const { stem, ext } = splitName(original)
  const suffix = index <= 0 ? '' : `(${index})`
  return `${clampStem(stem, `${suffix}${ext}`)}${suffix}${ext}`
}

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
