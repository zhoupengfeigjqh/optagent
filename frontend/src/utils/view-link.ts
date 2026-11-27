
import type { ViewLink } from '../api/types'
import { splitProducedPath } from './produced-display'

export const VIEW_URL_FIELD = 'viewUrl'

/** 入口行**直接显示**的条数上限；超出走「另有 N 个」，不静默丢弃（`TR-47`）。 */
export const VIEW_LINK_DISPLAY_MAX = 3

/**
 * 无名称时地址的显示长度上限（超出做**中段**省略）。
 *
 * 为什么是中段省略：尾部（目录段 + 文件名）才是最有辨识度的部分，
 * 尾部省略（`text-overflow: ellipsis`）恰好会把最有用的一段吃掉。
 */
export const VIEW_LINK_ADDRESS_MAX_CHARS = 32

export interface ViewLinkEntry {
  href: string
  raw: string
  name?: string
  kind: 'url' | 'file'
}

export interface ViewLinkTarget {
  url: string
  /** 显示名（有名称用名称，否则中段省略的地址 / 路径） */
  name: string
  kind: 'url' | 'file'
  filePath?: string
}

export function toViewLinkEntries(
  links: readonly ViewLink[] | undefined,
  origin?: string,
): ViewLinkEntry[] {
  const byHref = new Map<string, ViewLinkEntry>()

  for (const link of links ?? []) {
    const raw = link.url.trim()
    if (raw === '') continue
    const kind: ViewLinkEntry['kind'] = link.kind === 'file' ? 'file' : 'url'
    const source = kind === 'file' ? filePathToPreviewPath(raw) : raw
    const href = resolveViewUrl(source, origin)
    if (href === null) continue

    const name = normalizedName(link.name)
    const existing = byHref.get(href)
    if (existing) {
      if (existing.name === undefined && name !== undefined) existing.name = name
      continue
    }
    byHref.set(href, name === undefined ? { href, raw, kind } : { href, raw, kind, name })
  }

  return [...byHref.values()]
}

function normalizedName(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined
  const trimmed = name.trim()
  return trimmed === '' ? undefined : trimmed
}

export function viewLinkLabel(entry: ViewLinkEntry): string {
  return entry.name ?? truncateMiddle(entry.raw, VIEW_LINK_ADDRESS_MAX_CHARS)
}

export function viewLinkTitle(entry: ViewLinkEntry): string {
  const address = entry.kind === 'file' ? entry.raw : entry.href
  return entry.name === undefined ? address : `${entry.name} — ${address}`
}

export function toViewLinkTarget(entry: ViewLinkEntry): ViewLinkTarget {
  const base: ViewLinkTarget = { url: entry.href, name: viewLinkLabel(entry), kind: entry.kind }
  return entry.kind === 'file' ? { ...base, filePath: entry.raw } : base
}

export function truncateMiddle(text: string, maxChars: number): string {
  if (maxChars <= 1 || text.length <= maxChars) return text
  const head = Math.ceil((maxChars - 1) / 2)
  const tail = maxChars - 1 - head
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}

/**
 * 是否是视图链接字段。
 *
 * 只看**字段名**（大小写不敏感），不看值像不像 URL：否则正文里任何形如 `/api/…`
 * 的普通字段都会被链接化，那是误报而不是功能。
 */
export function isViewUrlField(field: unknown): boolean {
  return typeof field === 'string' && field.trim().toLowerCase() === VIEW_URL_FIELD.toLowerCase()
}

export function resolveViewUrl(value: unknown, origin?: string): string | null {
  if (typeof value !== 'string') return null

  const raw = value.trim()
  if (raw === '') return null
  if (hasControlOrBackslash(raw)) return null

  if (/^https?:\/\//i.test(raw)) return raw

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null

  // ② 只认**单个** `/` 开头的根相对路径；`//host/…` 是协议相对 URL，必须在这里挡掉
  if (!raw.startsWith('/') || raw.startsWith('//')) return null

  const base = origin ?? currentOrigin()
  if (base === '') return null
  try {
    return new URL(raw, base).href
  } catch {
    return null
  }
}

export function filePathToPreviewPath(filePath: string): string {
  const { dir, filename } = splitProducedPath(filePath)
  const search = new URLSearchParams()
  if (dir !== '') search.append('dir', dir)
  search.append('filename', filename)
  return `/api/files/preview?${search.toString()}`
}

export function isSameOrigin(href: string, origin?: string): boolean {
  const base = origin ?? currentOrigin()
  if (base === '') return false
  try {
    return new URL(href, base).origin === base
  } catch {
    return false
  }
}

/**
 * 是否含控制字符（含 `\t\n\r`）或反斜杠。
 *
 * 它们在地址里没有任何合法用途，且是常见的绕过手法（如用制表符骗过前缀判断）。
 * 用显式码点判断而非正则：控制字符正则会被 `no-control-regex` 规则挡住，而该规则的
 * 意图（拒绝不可见字符）与本函数重合，没有理由为它禁用规则。
 */
function hasControlOrBackslash(raw: string): boolean {
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f || char === '\\') return true
  }
  return false
}

function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}
