/**
 * 单元测试：异步工具判据（2026-10-03）
 *
 * 该判据决定「后台计算（异步工具）」里**列不列**某个工具，且 MUST 与运行环境
 * `agent-backend/src/infra/mcp/async-result-url.ts` 的 `declaresResultUrl()` 同口径
 * ——两边不一致会造成"界面列了但不注入"或反之。
 */
import { describe, expect, it } from 'vitest'
import { ASYNC_RESULT_URL_PARAM, hasResultUrl } from './async-tool'

describe('hasResultUrl', () => {
  it('参数名与运行环境一致（resultUrl）', () => {
    expect(ASYNC_RESULT_URL_PARAM).toBe('resultUrl')
  })

  it('properties 里声明了 resultUrl → true', () => {
    expect(
      hasResultUrl({ type: 'object', properties: { resultUrl: { type: 'string' } } }),
    ).toBe(true)
  })

  it('properties 里没有它 → false（同步工具）', () => {
    expect(hasResultUrl({ type: 'object', properties: { job_id: { type: 'string' } } })).toBe(false)
    expect(hasResultUrl({ type: 'object', properties: {} })).toBe(false)
  })

  it('形状异常一律 false（不抛错——判据只用于"列不列"，不该让整页崩）', () => {
    for (const bad of [undefined, null, 42, 'x', [], {}, { properties: null }, { properties: 1 }]) {
      expect(hasResultUrl(bad)).toBe(false)
    }
  })

  it('required 里出现但 properties 未声明 → false（平台注入判据只看 properties）', () => {
    expect(hasResultUrl({ type: 'object', required: ['resultUrl'], properties: {} })).toBe(false)
  })
})
