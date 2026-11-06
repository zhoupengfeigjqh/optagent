/**
 * 单测：术语替换预检客户端（018）。
 *
 * 只守"请求形状与解码"：路径、方法、请求体；后端返回什么就原样交给上层，
 * 不做业务裁剪（开关/降级判断都在服务端与 `useTermNormalize`）。
 */
import { describe, expect, it } from 'vitest'

import { createHttpClient } from './http'
import { createTermNormalizeApi } from './term-normalize'

function apiWith(payload: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { api: createTermNormalizeApi(createHttpClient({ fetchImpl })), calls }
}

describe('createTermNormalizeApi', () => {
  it('POST /api/term-normalize，请求体只有 content', async () => {
    const { api, calls } = apiWith({
      applied: true,
      original: '看供应商信息',
      normalized: '看供应商',
      matches: [],
    })

    const result = await api.review('看供应商信息')

    expect(calls[0]!.url).toBe('/api/term-normalize')
    expect(calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ content: '看供应商信息' })
    expect(result.applied).toBe(true)
    expect(result.normalized).toBe('看供应商')
  })

  it('服务端返回未替换时也原样返回（由上层决定是否继续）', async () => {
    const { api } = apiWith({ applied: false, original: '你好', normalized: '你好', matches: [] })
    await expect(api.review('你好')).resolves.toEqual({
      applied: false,
      original: '你好',
      normalized: '你好',
      matches: [],
    })
  })

  it('可传入 signal（调用方用于 1.5s 超时取消）', async () => {
    const { api, calls } = apiWith({ applied: false, original: 'a', normalized: 'a', matches: [] })
    const controller = new AbortController()
    await api.review('a', controller.signal)
    expect(calls[0]!.init.signal).toBe(controller.signal)
  })
})
