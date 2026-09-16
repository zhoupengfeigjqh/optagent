/**
 * 单元测试：路由（T027）
 *
 * 自建路由属"自研基础设施"，故 MUST 有单测（原则三、`research.md` D5）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ROUTE,
  buildPath,
  createRouter,
  normalizeBase,
  parseLocation,
  ROUTE_NAMES,
} from './router'

describe('normalizeBase', () => {
  it('空串与 / 归一为空基址', () => {
    expect(normalizeBase('')).toBe('')
    expect(normalizeBase('/')).toBe('')
  })

  it('去掉重复与结尾斜杠', () => {
    expect(normalizeBase('admin')).toBe('/admin')
    expect(normalizeBase('/admin/')).toBe('/admin')
    expect(normalizeBase('//admin//')).toBe('/admin')
  })
})

describe('parseLocation', () => {
  it('默认路由为数字人设计', () => {
    const r = parseLocation('/admin/', '/admin')
    expect(r.name).toBe(DEFAULT_ROUTE)
    expect(r.name).toBe('agents')
    expect(r.detail).toBeNull()
    expect(r.tab).toBeNull()
  })

  it('解析四个功能区', () => {
    for (const name of ROUTE_NAMES) {
      expect(parseLocation(`/admin/${name}`, '/admin').name).toBe(name)
    }
  })

  it('解析详情对象并做 URL 解码', () => {
    expect(parseLocation('/admin/agents/demo', '/admin').detail).toBe('demo')
    expect(parseLocation(`/admin/skills/${encodeURIComponent('中文技能')}`, '/admin').detail).toBe(
      '中文技能',
    )
  })

  it('tab 来自查询串', () => {
    const r = parseLocation('/admin/deploy?tab=anomalies', '/admin')
    expect(r.name).toBe('deploy')
    expect(r.tab).toBe('anomalies')
    expect(r.detail).toBeNull()
  })

  it('未知功能区回退默认路由（可刷新、可分享）', () => {
    const r = parseLocation('/admin/unknown/xyz', '/admin')
    expect(r.name).toBe(DEFAULT_ROUTE)
    expect(r.detail).toBeNull()
  })

  it('无 base 前缀时也能解析（开发期直接访问根路径）', () => {
    expect(parseLocation('/agents/demo', '').detail).toBe('demo')
  })

  it('path 为规范化后的相对路径（供 navigate 复用）', () => {
    expect(parseLocation('/admin/agents/demo?tab=mcp', '/admin').path).toBe('/agents/demo?tab=mcp')
  })
})

describe('buildPath', () => {
  it('含 base、详情与 tab', () => {
    expect(buildPath({ name: 'agents', detail: 'demo', tab: 'mcp' }, '/admin')).toBe(
      '/admin/agents/demo?tab=mcp',
    )
  })

  it('省略空查询键，并对详情编码', () => {
    expect(buildPath({ name: 'skills', detail: '中文技能' }, '/admin')).toBe(
      `/admin/skills/${encodeURIComponent('中文技能')}`,
    )
  })

  it('额外查询参数被保留（tab 不重复）', () => {
    const p = buildPath({ name: 'mcp', query: { page: 2, tab: 'ignored', empty: '' } }, '/admin')
    expect(p).toBe('/admin/mcp?page=2')
  })
})

describe('createRouter', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/admin/agents')
  })

  it('初始路由来自当前 location', () => {
    const router = createRouter({ base: '/admin' })
    expect(router.current.value.name).toBe('agents')
    router.destroy()
  })

  it('navigate 压栈并同步当前路由', () => {
    const router = createRouter({ base: '/admin' })
    router.navigate('/skills')
    expect(router.current.value.name).toBe('skills')
    expect(window.location.pathname).toBe('/admin/skills')
    router.destroy()
  })

  it('replace 不新增历史记录', () => {
    const router = createRouter({ base: '/admin' })
    const before = window.history.length
    router.navigate('/mcp', { replace: true })
    expect(window.history.length).toBe(before)
    expect(router.current.value.name).toBe('mcp')
    router.destroy()
  })

  it('popstate 时重新解析（浏览器前进/后退键行为正确）', () => {
    const router = createRouter({ base: '/admin' })
    window.history.pushState(null, '', '/admin/deploy')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(router.current.value.name).toBe('deploy')
    router.destroy()
  })

  it('destroy 后不再响应 popstate', () => {
    const router = createRouter({ base: '/admin' })
    router.destroy()
    const spy = vi.fn()
    window.addEventListener('popstate', spy)
    window.history.pushState(null, '', '/admin/mcp')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(spy).toHaveBeenCalledTimes(1)
    // 路由实例已卸载，不再自行解析
    expect(router.current.value.name).toBe('agents')
    window.removeEventListener('popstate', spy)
  })
})
