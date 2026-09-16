/**
 * 极简路由（原生 History API + `popstate`，**不引入 `vue-router`**，`research.md` D5）。
 *
 * 管理界面的导航模型是**常驻一级导航 4 项**（`FR-053`）+ 功能区内两级
 * （列表 ↔ 详情/编辑器），不需要嵌套路由与守卫，`vue-router` 的收益不足以
 * 抵消新增依赖与升级成本（原则六）。
 *
 * 路径方案：`{base}/{功能区}[/{详情对象}]?tab={功能区内分区}`
 *  - `/admin/agents`            → 数字人设计列表
 *  - `/admin/agents/demo`       → 数字人 demo 的设计态
 *  - `/admin/agents/demo?tab=mcp` → 设计态内 MCP 页签
 *  - `/admin/deploy?tab=anomalies` → 部署区内的异常项汇总分区
 *
 * 自建路由属"自研基础设施"，故 MUST 有单元测试（原则三、D5）。
 */
import { ref, type Ref } from 'vue'

/** 四个功能区（常驻一级导航，`FR-053`） */
export const ROUTE_NAMES = ['mcp', 'skills', 'agents', 'deploy'] as const
export type RouteName = (typeof ROUTE_NAMES)[number]

/** 一级导航条目（标签与顺序即界面呈现顺序） */
export const NAV_ITEMS: ReadonlyArray<{ name: RouteName; label: string }> = [
  { name: 'mcp', label: 'MCP 服务' },
  { name: 'skills', label: 'SKILL 管理' },
  { name: 'agents', label: '数字人设计' },
  { name: 'deploy', label: '数字人部署' },
]

/** 无路径时的默认功能区：数字人设计（P1 MVP 功能区） */
export const DEFAULT_ROUTE: RouteName = 'agents'

export interface AdminRoute {
  name: RouteName
  /** 详情/编辑对象标识（数字人名、SKILL 名、MCP 服务名）；无则为 `null` */
  detail: string | null
  /** 功能区内分区（页签）标识；无则为 `null` */
  tab: string | null
  query: Record<string, string>
  /** 相对 base 的规范路径（如 `/agents/demo`），供 `navigate` 复用 */
  path: string
}

/** 去掉结尾斜杠，保证 `/admin` 与 `/admin/` 等价 */
export function normalizeBase(base: string): string {
  const trimmed = base.trim()
  if (trimmed === '' || trimmed === '/') return ''
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

export function isRouteName(value: string): value is RouteName {
  return (ROUTE_NAMES as readonly string[]).includes(value)
}

/**
 * 解析任意路径为路由（**纯函数**，便于单测）。
 * 未知功能区回退默认路由；`detail` 做一次 `decodeURIComponent`。
 */
export function parseLocation(fullPath: string, base = ''): AdminRoute {
  const normalizedBase = normalizeBase(base)
  const [rawPath = '', rawQuery = ''] = fullPath.split('?', 2)

  let rest = rawPath
  if (normalizedBase && rest.startsWith(normalizedBase)) {
    rest = rest.slice(normalizedBase.length)
  }
  const segments = rest.split('/').filter((s) => s !== '')

  const query: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(rawQuery ?? '')) {
    query[key] = value
  }

  const first = segments[0]
  const name: RouteName = first && isRouteName(first) ? first : DEFAULT_ROUTE
  const detail = first && isRouteName(first) ? (segments[1] ?? null) : null
  const decodedDetail = detail ? safeDecode(detail) : null
  const tab = query.tab ?? null

  return {
    name,
    detail: decodedDetail,
    tab,
    query,
    path: buildPath({ name, detail: decodedDetail, tab, query }),
  }
}

/** 构造规范路径（含 base）；`null` / `undefined` / 空串的查询键会被省略 */
export function buildPath(
  parts: {
    name: RouteName
    detail?: string | null
    tab?: string | null
    query?: Record<string, string | number | null | undefined>
  },
  base = '',
): string {
  const segments: string[] = [parts.name]
  if (parts.detail) segments.push(encodeURIComponent(parts.detail))

  const search = new URLSearchParams()
  if (parts.tab) search.set('tab', parts.tab)
  for (const [key, value] of Object.entries(parts.query ?? {})) {
    if (key === 'tab') continue
    if (value === null || value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const queryString = search.toString()
  return `${normalizeBase(base)}/${segments.join('/')}${queryString ? `?${queryString}` : ''}`
}

export interface Router {
  /** 当前路由（响应式） */
  readonly current: Readonly<Ref<AdminRoute>>
  /** 编程式导航（默认压栈；`replace` 则不新增历史记录） */
  navigate(path: string, options?: { replace?: boolean }): void
  /** 释放 `popstate` 监听 */
  destroy(): void
}

export interface RouterOptions {
  /** 应用基址（生产为 `/admin`，开发同值） */
  base?: string
  /** 外部注入的历史栈与 location（测试用） */
  win?: Pick<Window, 'history' | 'location'> & {
    addEventListener?: Window['addEventListener']
    removeEventListener?: Window['removeEventListener']
  }
}

/** 创建路由实例 */
export function createRouter(options: RouterOptions = {}): Router {
  const base = normalizeBase(options.base ?? '/admin')
  const win = (options.win ?? globalThis.window) as Window
  const current = ref<AdminRoute>(parseLocation(win.location.pathname + win.location.search, base))

  const sync = (): void => {
    current.value = parseLocation(win.location.pathname + win.location.search, base)
  }

  const onPopState = (): void => sync()
  win.addEventListener?.('popstate', onPopState)

  return {
    current,
    navigate(path, navigateOptions = {}) {
      const next = path.startsWith('/') ? path : `/${path}`
      const full = `${base}${next}`
      if (navigateOptions.replace) win.history.replaceState(null, '', full)
      else win.history.pushState(null, '', full)
      sync()
    },
    destroy() {
      win.removeEventListener?.('popstate', onPopState)
    },
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
