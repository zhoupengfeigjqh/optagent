/**
 * 单元测试：下一步动作提示的拉取封装（007）。
 *
 * 这个模块的全部价值在于"把不确定的输入变成确定的形状"：
 * 正常命中 → 原样下发；脏形状 / 请求失败 → **空形态且不抛错**（FR-042：降级 MUST NOT 呈现错误）。
 */
import { describe, expect, it, vi } from 'vitest'
import { createHttpClient } from './http'
import { createNextStepsApi, emptyNextSteps } from './next-steps'

function apiWith(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchImpl = vi.fn(async (_url: string) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: init.status ?? (init.ok === false ? 500 : 200),
      headers: { 'content-type': 'application/json' },
    }),
  )
  const client = createHttpClient({ fetchImpl: fetchImpl as unknown as typeof fetch })
  return { api: createNextStepsApi(client), fetchImpl }
}

describe('createNextStepsApi', () => {
  it('命中：原样下发 `message_id` 与卡片（tools / guidance 保留）', async () => {
    const { api, fetchImpl } = apiWith({
      message_id: 'm-1',
      actions: [
        {
          prompt: '按交付日期梳理这批订单的风险',
          tools: [{ kind: 'mcp', service: 'erp', name: 'query_order', exposed_name: 'erp__query_order' }],
          guidance: '本轮请优先使用以下工具完成任务：erp__query_order',
        },
      ],
    })

    const result = await api.fetch('th_1')

    expect(result.message_id).toBe('m-1')
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.guidance).toContain('erp__query_order')
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/threads/th_1/next-actions')
  })

  it('无建议（`message_id: null` + 空数组）→ 原样空形态', async () => {
    const { api } = apiWith({ message_id: null, actions: [] })

    expect(await api.fetch('th_1')).toEqual(emptyNextSteps())
  })

  it('请求失败（5xx / 网络异常）→ 空形态，不抛错', async () => {
    const failed = apiWith({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }, { ok: false })
    expect(await failed.api.fetch('th_1')).toEqual(emptyNextSteps())

    const network = createNextStepsApi(
      createHttpClient({
        fetchImpl: (() => Promise.reject(new Error('断网'))) as unknown as typeof fetch,
      }),
    )
    expect(await network.fetch('th_1')).toEqual(emptyNextSteps())
  })

  it('形状非法（顶层非对象 / actions 非数组）→ 空形态', async () => {
    for (const body of ['null', '[]', '{"message_id":1,"actions":[]}', '{"message_id":"m","actions":{}}']) {
      const { api } = apiWith(body)
      expect(await api.fetch('th_1')).toEqual(emptyNextSteps())
    }
  })

  it('逐条校验：缺 prompt 的条目被丢弃；`tools` / `guidance` 缺失时补齐为空值', async () => {
    const { api } = apiWith({
      message_id: 'm-1',
      actions: [
        { prompt: '整理共享空间的表格' },
        { prompt: '' },
        { guidance: '没有提示词' },
        'not-an-object',
      ],
    })

    const result = await api.fetch('th_1')

    expect(result.actions).toEqual([{ prompt: '整理共享空间的表格', tools: [], guidance: '' }])
  })

  it('全部条目都不合法 → 空形态（不留下"有 message_id 却没有卡片"的半截状态）', async () => {
    const { api } = apiWith({ message_id: 'm-1', actions: [{ prompt: '' }] })

    expect(await api.fetch('th_1')).toEqual(emptyNextSteps())
  })
})
