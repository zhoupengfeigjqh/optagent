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
 *
 * 2026-10-15：`ViewLink.kind === 'file'`（本地文件空间相对路径）**不走上面的拒绝规则**——
 * 它是"空间相对路径"，先经 `filePathToPreviewPath()` 转成 `/api/files/preview?…`
 * （根相对路径），再按同样规则归一化。是否同源另由 `isSameOrigin()` 判定。
 */

import type { ViewLink } from '../api/types'
import { splitProducedPath } from './produced-display'

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
  /**
   * 来源形态（2026-10-15）：`'file'` = 本地文件空间相对路径（`raw` 就是那条路径）；
   * `'url'` = 外部 / 同源地址。
   *
   * 必须**随行携带**：它决定点开后的渲染口径（相对路径按扩展名预览；地址按响应头预检），
   * 而 `href` 对两者都是绝对地址，事后无法反推——从 `/api/files/preview?…` 解析回
   * `dir`/`filename` 是拿前端自己拼的串当输入，等于自欺。
   */
  kind: 'url' | 'file'
}

/**
 * 入口点击后交给上层的跳转目标（2026-10-15，跨组件契约）。
 *
 * 与 `ViewLinkEntry` 的分工：`ViewLinkEntry` 是**入口行长什么样**（含显示文本、去重键），
 * 这里是**点下去要做什么**（只留跳转必需的信息）。装配层（`usePreview`）据此二选一：
 * - `kind: 'file'` + `filePath` → 与"在文件空间里点文件"**同一条路**（按扩展名预览）
 * - 其余 → 同源预检 / 异源直跳
 */
export interface ViewLinkTarget {
  /** 可点开的绝对地址（`kind:'file'` 时是 `/api/files/preview?…`，供中键 / 复制链接） */
  url: string
  /** 显示名（有名称用名称，否则中段省略的地址 / 路径） */
  name: string
  /** 来源形态（缺省的 `viewUrl` 一律为 `'url'`） */
  kind: 'url' | 'file'
  /** `kind: 'file'` 时的空间相对路径（上层据此拆 `dir` + `filename`） */
  filePath?: string
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
    const raw = link.url.trim()
    if (raw === '') continue
    // `kind: 'file'` 是本地文件空间相对路径：先转成预览接口地址，再按同一规则归一化（拼入口）
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
    // 显示文本仍取**原值**：文件路径（`数据准备/x.pdf`）比 `/api/files/preview?…` 可读
    byHref.set(href, name === undefined ? { href, raw, kind } : { href, raw, kind, name })
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

/**
 * 入口的悬停提示：有名称时 `名称 — 可核对的地址`，无名称时只给地址。
 *
 * 2026-10-15 修正：`kind: 'file'` 的"可核对地址"取**原相对路径**而不是 `href`。
 * 原因是 `href` 是前端自己拼的 `/api/files/preview?dir=%E6%95%B0…`（含 URL 编码），
 * 拿它给用户核对等于让人读一串编码——而用户能对上号的是 `数据准备/9月计划.xlsx`。
 * 外部地址（`kind: 'url'`）仍给 `href`：那里的绝对形式才可复制可核对。
 */
export function viewLinkTitle(entry: ViewLinkEntry): string {
  const address = entry.kind === 'file' ? entry.raw : entry.href
  return entry.name === undefined ? address : `${entry.name} — ${address}`
}

/**
 * 入口行的一项 → 交给装配层的跳转目标（`ViewLinkTarget`）。
 *
 * 映射放在这里而不是组件里：组件只负责"点了哪一项"，**点下去要做什么**是纯函数，
 * 才好被单测钉住（跨组件契约的漂移是最难查的那类）。
 */
export function toViewLinkTarget(entry: ViewLinkEntry): ViewLinkTarget {
  const base: ViewLinkTarget = { url: entry.href, name: viewLinkLabel(entry), kind: entry.kind }
  // `kind: 'url'` 不写 `filePath`：上层据此判"这不是文件，别按扩展名预览"
  return entry.kind === 'file' ? { ...base, filePath: entry.raw } : base
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
 * 本地文件空间相对路径（`filePath`）→ 预览接口地址（根相对路径，单个 `/` 开头）。
 *
 * `数据准备/生产计划/9月计划.xlsx` → `dir` + `filename` → `/api/files/preview?dir=…&filename=…`
 * （`URLSearchParams` 负责中文与斜杠的编码）。无分隔符时 `dir` 为空串——**不猜**：
 * 照样构造、交给预览接口按自己的口径报可读错误，好过前端拼出一个必然错的路径。
 *
 * 只拼**根相对路径**（前缀 = 用户当前入口，由 `resolveViewUrl` 补）。
 */
export function filePathToPreviewPath(filePath: string): string {
  const { dir, filename } = splitProducedPath(filePath)
  const search = new URLSearchParams()
  if (dir !== '') search.append('dir', dir)
  search.append('filename', filename)
  return `/api/files/preview?${search.toString()}`
}

/**
 * 是否与当前访问入口**同源**（协议 + 主机 + 端口三者相同）。
 *
 * 判据是标准 `origin` 比较——**不是**"ip+端口一致"：`https://a` vs `http://a`、
 * `localhost` vs `127.0.0.1` 都算跨域，只看 ip+端口会误判。
 *
 * `origin` 可注入（默认 `window.location.origin`）：单测不依赖真实 `location`。
 * 非法地址（`new URL` 抛错）一律**不当同源**（保守：走外部跳转而不是往 iframe 里塞）。
 */
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

/** 当前页面入口；非浏览器环境（如 SSR/纯 node）返回空串。 */
function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}
