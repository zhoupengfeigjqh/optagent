import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFilesApi } from '../api/files'
import { createHttpClient } from '../api/http'
import { createFetchRouter, errorResponse, jsonResponse } from '../../tests/helpers'
import { createPreviewStore } from './usePreview'

function makeStore(routes: Parameters<typeof createFetchRouter>[0]) {
  const router = createFetchRouter(routes)
  const files = createFilesApi(createHttpClient({ baseUrl: '', fetchImpl: router.fetch }))
  return { store: createPreviewStore({ files }), router }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('usePreview - 外部地址（V-10）', () => {
  it('openLink 打开新窗口且不改变预览目标', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { store } = makeStore({})

    store.openLink('https://example.com/doc')

    expect(open).toHaveBeenCalledWith('https://example.com/doc', '_blank', 'noopener,noreferrer')
    expect(store.target.value).toEqual({ kind: 'none' })
    expect(store.content.value).toBeNull()
  })

  it('已有预览目标时 openLink 也不改变目标', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const { store } = makeStore({})
    await store.openFile({ dir: 'tmp', filename: 'a.xlsx' })

    store.openLink('https://example.com')

    expect(store.target.value).toEqual({ kind: 'file', dir: 'tmp', filename: 'a.xlsx' })
  })
})

describe('usePreview - 空间目录文件（V-11）', () => {
  it('.xlsx 回退为下载引导（不内联）', async () => {
    const { store } = makeStore({})

    await store.openFile({ dir: '生产计划', filename: '计划.xlsx' })

    expect(store.target.value).toEqual({
      kind: 'file',
      dir: '生产计划',
      filename: '计划.xlsx',
    })
    expect(store.content.value?.renderMode).toBe('download')
    expect(store.content.value?.url).toContain('/api/files/download?')
    expect(store.content.value?.url).toContain('filename=')
  })

  it('未知扩展名同样回退为下载引导', async () => {
    const { store } = makeStore({})

    await store.openFile({ dir: 'tmp', filename: 'a.docx' })

    expect(store.content.value?.renderMode).toBe('download')
  })

  it('.pdf 先预检再交给 iframe 直链（FR-048）', async () => {
    const { store, router } = makeStore({
      'GET /api/files/preview': () => new Response(null, { status: 200 }),
    })

    await store.openFile({ dir: '使用规则', filename: '规则.pdf' })

    expect(store.content.value?.renderMode).toBe('pdf')
    expect(store.content.value?.url).toContain('/api/files/preview?')
    expect(router.countOf('GET', '/api/files/preview')).toBe(1)
    expect(store.loading.value).toBe(false)
  })

  it('.pdf 超限（413）→ 错误态 + 下载引导，不再交给 iframe（FR-048）', async () => {
    const { store } = makeStore({
      'GET /api/files/preview': () => errorResponse('FILE_TOO_LARGE', 'too large', 413),
    })

    await store.openFile({ dir: 'tmp', filename: 'big.pdf' })

    expect(store.content.value?.renderMode).toBe('error')
    expect(store.content.value?.error?.code).toBe('FILE_TOO_LARGE')
    expect(store.content.value?.url).toContain('/api/files/download?')
  })

  it('.pdf 不存在（404）→ 错误态（FR-048）', async () => {
    const { store } = makeStore({
      'GET /api/files/preview': () => errorResponse('FILE_NOT_FOUND', 'missing', 404),
    })

    await store.openFile({ dir: 'tmp', filename: 'gone.pdf' })

    expect(store.content.value?.renderMode).toBe('error')
    expect(store.content.value?.error?.code).toBe('FILE_NOT_FOUND')
  })

  it('.pdf 预检未返回时切换目标，旧响应不回填（请求序号守卫）', async () => {
    let release: (value: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    const { store } = makeStore({ 'GET /api/files/preview': () => pending })

    const task = store.openFile({ dir: 'tmp', filename: 'a.pdf' })
    store.close()
    release(new Response(null, { status: 200 }))
    await task

    expect(store.target.value).toEqual({ kind: 'none' })
    expect(store.content.value).toBeNull()
  })

  it('.txt / .csv / .json 拉取文本内容内联展示', async () => {
    const { store } = makeStore({
      'GET /api/files/preview': () => new Response('a,b\n1,2', { status: 200 }),
    })

    await store.openFile({ dir: '生产计划', filename: '计划.csv' })

    expect(store.content.value).toEqual({
      renderMode: 'text',
      text: 'a,b\n1,2',
      url: null,
      error: null,
    })
    expect(store.loading.value).toBe(false)
  })

  it('预览超限（413）进入错误态并给出下载地址（FR-048）', async () => {
    const { store } = makeStore({
      'GET /api/files/preview': () => errorResponse('FILE_TOO_LARGE', 'too large', 413),
    })

    await store.openFile({ dir: 'tmp', filename: 'big.txt' })

    expect(store.content.value?.renderMode).toBe('error')
    expect(store.content.value?.error?.code).toBe('FILE_TOO_LARGE')
    expect(store.content.value?.url).toContain('/api/files/download?')
  })

  it('文件不存在（404）进入错误态', async () => {
    const { store } = makeStore({
      'GET /api/files/preview': () => errorResponse('FILE_NOT_FOUND', 'missing', 404),
    })

    await store.openFile({ dir: 'tmp', filename: 'gone.txt' })

    expect(store.content.value?.renderMode).toBe('error')
    expect(store.content.value?.error?.code).toBe('FILE_NOT_FOUND')
  })

  it('关闭预览清空目标与内容', async () => {
    const { store } = makeStore({
      'GET /api/files/preview': () => new Response('x', { status: 200 }),
    })
    await store.openFile({ dir: 'tmp', filename: 'a.txt' })

    store.close()

    expect(store.target.value).toEqual({ kind: 'none' })
    expect(store.content.value).toBeNull()
    expect(store.loading.value).toBe(false)
  })

  it('快速切换文件时旧响应不覆盖新目标（请求序号守卫）', async () => {
    const slow = new Promise<Response>((resolve) => {
      setTimeout(() => resolve(new Response('OLD', { status: 200 })), 20)
    })
    const { store } = makeStore({
      'GET /api/files/preview': () => slow,
    })

    const first = store.openFile({ dir: 'tmp', filename: 'old.txt' })
    store.close()
    await first

    expect(store.target.value).toEqual({ kind: 'none' })
    expect(store.content.value).toBeNull()
  })

  it('openFile 初始加载中 loading 为 true', async () => {
    let release: (value: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    const { store } = makeStore({ 'GET /api/files/preview': () => pending })

    const task = store.openFile({ dir: 'tmp', filename: 'a.txt' })
    expect(store.loading.value).toBe(true)

    release(new Response('done', { status: 200 }))
    await task

    expect(store.loading.value).toBe(false)
    expect(store.content.value?.text).toBe('done')
  })

  it('download 触发直链下载（不经 fetch）', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const { store, router } = makeStore({})

    store.download({ dir: '生产计划', filename: '计划.xlsx' })

    expect(click).toHaveBeenCalledTimes(1)
    expect(router.calls).toHaveLength(0)
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('非文本类的 url 编码目录名与文件名', async () => {
    const { store } = makeStore({
      'GET /api/files/preview': () => new Response(null, { status: 200 }),
    })

    await store.openFile({ dir: '使用规则', filename: '规则 v1.pdf' })

    expect(store.content.value?.url).toContain(
      `dir=${encodeURIComponent('使用规则').replace(/%20/g, '+')}`,
    )
    expect(store.content.value?.url).toContain('filename=%E8%A7%84%E5%88%99+v1.pdf')
  })

  it('jsonResponse 桩件可复用于文本类预览', async () => {
    const { store } = makeStore({
      'GET /api/files/preview': () => jsonResponse({ ok: true }),
    })

    await store.openFile({ dir: 'tmp', filename: 'a.json' })

    expect(store.content.value?.text).toBe('{"ok":true}')
  })
})
