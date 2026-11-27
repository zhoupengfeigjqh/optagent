import { ref, type Ref } from 'vue'

export const ROUTE_NAMES = ['mcp', 'ontology', 'skills', 'agents', 'deploy'] as const
export type RouteName = (typeof ROUTE_NAMES)[number]

export const NAV_ITEMS: ReadonlyArray<{ name: RouteName; label: string }> = [
  { name: 'mcp', label: 'MCP 服务' },
  { name: 'ontology', label: '本体管理' },
  { name: 'skills', label: 'SKILL 管理' },
  { name: 'agents', label: '数字人设计' },
  { name: 'deploy', label: '数字人部署' },
]

export const DEFAULT_ROUTE: RouteName = 'agents'

export interface AdminRoute {
  name: RouteName
  detail: string | null
  tab: string | null
  query: Record<string, string>
  path: string
}

export function normalizeBase(base: string): string {
  const trimmed = base.trim()
  if (trimmed === '' || trimmed === '/') return ''
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

export function isRouteName(value: string): value is RouteName {
  return (ROUTE_NAMES as readonly string[]).includes(value)
}

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
  const restSegments = first && isRouteName(first) ? segments.slice(1) : []
  const detailSegments = name === 'ontology' ? restSegments : restSegments.slice(0, 1)
  const decodedDetail =
    detailSegments.length > 0
      ? detailSegments.map((segment) => safeDecode(segment)).join('/')
      : null
  const tab = query.tab ?? null

  return {
    name,
    detail: decodedDetail,
    tab,
    query,
    path: buildPath({ name, detail: decodedDetail, tab, query }),
  }
}

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
  if (parts.detail) {
    for (const segment of parts.detail.split('/')) {
      if (segment !== '') segments.push(encodeURIComponent(segment))
    }
  }

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
  readonly current: Readonly<Ref<AdminRoute>>
  navigate(path: string, options?: { replace?: boolean }): void
  destroy(): void
}

export interface RouterOptions {
  base?: string
  win?: Pick<Window, 'history' | 'location'> & {
    addEventListener?: Window['addEventListener']
    removeEventListener?: Window['removeEventListener']
  }
}

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
