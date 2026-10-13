/**
 * 产出正文的视图链接（字段名 `viewUrl`）→ 可点地址（纯函数，2026-10-10，`TR-40`~`TR-43`）。
 *
 * **为什么需要它**：异步产出的正文由**外部服务**回写，其中的 `viewUrl` 值是"已经生成好的
 * 跳转地址"，但**常常缺 `http://host:port` 前缀**（只剩路径）——缺前缀时它只是死文本，
 * 用户看得见、点不动；"能不能点"不该由服务是否记得拼前缀决定。
 *
 * **为什么在这里拼前缀**：前缀 = "用户当前访问的入口"，只有浏览器知道
 * （`window.location.origin`）。写死 ip:端口会在开发（5173）/ 生产（网关）/ 换域名 /
 * 加 HTTPS 时全部失效。
 *
 * **输入是不可信内容**（服务回写的正文），因此只认两种形态，其余一律返回 `null`
 * 交给调用方按普通文本渲染——拼错一个字符就可能把用户送到别人的站点：
 * - ① 已带协议前缀 `http(s)://` → **原样返回**，绝不二次拼接；
 * - ② 根相对路径（**单个** `/` 开头）→ 拼当前入口；
 * - 其余形态 → `null`：协议相对的 `//host/…`（`new URL` 会把 host 换成对方）、
 *   无前导 `/` 的（会被解析成"相对当前路径"，落点不可预期）、其它 scheme
 *   （`javascript:` / `data:` …）、含控制字符或反斜杠的。
 */

import type { ViewLink } from '../api/types'

/** 视图链接的字段名（`TR-40` 判定用）。 */
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

/** 入口行的一项（已归一化、已按地址去重）。 */
export interface ViewLinkEntry {
  /** 完整绝对地址：去重键与跳转目标都用它 */
  href: string
  /** 服务给的原值（无名称时作为显示文本） */
  raw: string
  /** 服务给的名称；缺省 = 服务没给名字（界面显示地址） */
  name?: string
}

/**
 * 记录里的视图链接 → 入口行的一项（`TR-45`）。
 *
 * 做三件事，顺序固定：
 * 1. 归一化：`resolveViewUrl()`（唯一实现，见本模块头注释）；返回 `null` 的直接丢弃
 * 2. 按 `href` 去重：同一目标只留一项（跨工具重复也只留一项）
 * 3. 同一 `href` 重复出现时，**名称取首个非空值**（首个没给名字、后面给了就用后面那个）
 *
 * 为什么在这一层做去重：后端只能按"单次调用结果内"去重；同一条回答的**跨工具并集**
 * 只有前端拿得到，且归一化必须用浏览器的 `origin`（后端不许拼前缀，`TR-42`）。
 */
export function toViewLinkEntries(
  links: readonly ViewLink[] | undefined,
  origin?: string,
): ViewLinkEntry[] {
  const byHref = new Map<string, ViewLinkEntry>()

  for (const link of links ?? []) {
    const href = resolveViewUrl(link.url, origin)
    if (href === null) continue

    const name = normalizedName(link.name)
    const existing = byHref.get(href)
    if (existing) {
      if (existing.name === undefined && name !== undefined) existing.name = name
      continue
    }
    byHref.set(href, name === undefined ? { href, raw: link.url.trim() } : { href, raw: link.url.trim(), name })
  }

  return [...byHref.values()]
}

/** 名称卫生化：非字符串 / 空白 → `undefined`（视同没给名字）。 */
function normalizedName(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined
  const trimmed = name.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * 入口的显示文本（`TR-46`）：有名称用名称，没有则用地址（中段省略）。
 *
 * **不推断名称**（不拿同层业务字段、不从 URL 末段取名）、**不编号占位**
 * （"视图 1/2" 会随顺序漂移，等于假装有名字——宪章原则九）。
 */
export function viewLinkLabel(entry: ViewLinkEntry): string {
  return entry.name ?? truncateMiddle(entry.raw, VIEW_LINK_ADDRESS_MAX_CHARS)
}

/** 入口的悬停提示：有名称时 `名称 — 完整地址`，无名称时完整地址（地址永远可核对）。 */
export function viewLinkTitle(entry: ViewLinkEntry): string {
  return entry.name === undefined ? entry.href : `${entry.name} — ${entry.href}`
}

/** 中段省略：保留首段与末段（`maxChars` 含省略号本身）。 */
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

/**
 * 归一化：`viewUrl` 值 → 可点地址。
 *
 * 返回 `null` = **不是可识别的链接形态**（调用方按普通文本渲染）。
 * 这不是异常，故不抛错、也不需要日志（见 `plan.md` §3 的原则九判定）。
 *
 * `origin` 可注入（默认 `window.location.origin`）：单测因此不依赖真实 `location`（`TR-42`）。
 */
export function resolveViewUrl(value: unknown, origin?: string): string | null {
  if (typeof value !== 'string') return null

  const raw = value.trim()
  if (raw === '') return null
  if (hasControlOrBackslash(raw)) return null

  // ① 已带协议前缀：原样（`HTTP://` 交给浏览器按大小写不敏感处理）
  if (/^https?:\/\//i.test(raw)) return raw

  // 其它 scheme（`javascript:` / `data:` / `file:`…）：拒绝
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null

  // ② 只认**单个** `/` 开头的根相对路径；`//host/…` 是协议相对 URL，必须在这里挡掉
  if (!raw.startsWith('/') || raw.startsWith('//')) return null

  const base = origin ?? currentOrigin()
  if (base === '') return null
  try {
    return new URL(raw, base).href
  } catch {
    // 注入的 origin 不是合法基址（调用方传错）——不猜，按普通文本处理
    return null
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

/** 当前页面入口；非浏览器环境（如 SSR/纯 node）返回空串。 */
function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}
