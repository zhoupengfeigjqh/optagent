import { describe, expect, it, vi } from 'vitest'

import { probeRenderable } from './preview-probe'

function stubResponse(options: {
  ok?: boolean
  headers?: Record<string, string>
  cancel?: () => Promise<void>
}): Response {
  return {
    ok: options.ok ?? true,
    headers: new Headers(options.headers ?? {}),
    body: { cancel: options.cancel ?? (() => Promise.resolve()) },
  } as unknown as Response
}

function fetchReturning(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch
}

describe('probeRenderable —— 可内联渲染', () => {
  it.each([
    'text/html; charset=utf-8',
    'text/plain; charset=utf-8',
    'application/pdf',
    'application/json; charset=utf-8',
    'image/png',
    'TEXT/HTML',
  ])('%s → renderable', async (contentType) => {
    const fetchImpl = fetchReturning(stubResponse({ headers: { 'content-type': contentType } }))

    await expect(probeRenderable('/a', { fetchImpl })).resolves.toBe('renderable')
  })
})

describe('probeRenderable —— 需下载', () => {
  it('attachment 优先于 content-type：即使 text/html 也判下载', async () => {
    const fetchImpl = fetchReturning(
      stubResponse({
        headers: {
          'content-type': 'text/html',
          'content-disposition': "attachment; filename*=UTF-8''x.xlsx",
        },
      }),
    )

    await expect(probeRenderable('/a', { fetchImpl })).resolves.toBe('download')
  })

  it.each([
    ['application/octet-stream'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['application/zip'],
  ])('%s → download', async (contentType) => {
    const fetchImpl = fetchReturning(stubResponse({ headers: { 'content-type': contentType } }))

    await expect(probeRenderable('/a', { fetchImpl })).resolves.toBe('download')
  })

  it('没有 content-type → download（保守，不当可渲染）', async () => {
    const fetchImpl = fetchReturning(stubResponse({ headers: {} }))

    await expect(probeRenderable('/a', { fetchImpl })).resolves.toBe('download')
  })
})

describe('probeRenderable —— 降级与副作用', () => {
  it('网络错误 → fallback（不抛错）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch

    await expect(probeRenderable('/a', { fetchImpl })).resolves.toBe('fallback')
  })

  it('非 2xx → fallback', async () => {
    const fetchImpl = fetchReturning(
      stubResponse({ ok: false, headers: { 'content-type': 'text/html' } }),
    )

    await expect(probeRenderable('/a', { fetchImpl })).resolves.toBe('fallback')
  })

  it('读完立刻放弃响应体（cancel 恰好一次）', async () => {
    const cancel = vi.fn(async () => undefined)
    const fetchImpl = fetchReturning(
      stubResponse({ headers: { 'content-type': 'application/pdf' }, cancel }),
    )

    await probeRenderable('/a', { fetchImpl })

    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('cancel 抛错被吞掉（不影响判定）', async () => {
    const fetchImpl = fetchReturning(
      stubResponse({
        headers: { 'content-type': 'application/pdf' },
        cancel: async () => {
          throw new Error('cancel failed')
        },
      }),
    )

    await expect(probeRenderable('/a', { fetchImpl })).resolves.toBe('renderable')
  })
})
