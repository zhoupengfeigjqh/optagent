/**
 * 单测：术语替换确认状态机（018）。
 *
 * 守四条口径：
 * ① 没有替换（`applied:false`）→ 不打断，直接继续发送；
 * ② 有替换 → 只打开弹窗，**不发送**；
 * ③ 选择"替换后"→ 一次发送，载荷为 `normalized` + `skipTermCheck`（**不带**原话，
 *    2026-11-07 起聊天区显示的就是实际发出的那一版）；
 * ④ 选择"原话" / 预检异常 / 超时 → 一次发送，载荷不变（正文就是原话）；
 * ⑤ 确认后一律**发出即返回**（`settleBeforeReturn: false`）——弹窗不等本轮答完；
 * ⑥ 替换结果**可编辑但不可为空**（2026-11-07）：正文取用户最终确认的那一版，
 *    空文本不发送且弹窗保留。
 */
import { describe, expect, it, vi } from 'vitest'

import type { TermNormalizeApi, TermNormalizeResult } from '../api/term-normalize'
import { REVIEW_TIMEOUT_MS, useTermNormalize } from './useTermNormalize'

const PAYLOAD = { content: '看下供应商信息的库存', attachments: [] }

function applied(overrides: Partial<TermNormalizeResult> = {}): TermNormalizeResult {
  return {
    applied: true,
    original: PAYLOAD.content,
    normalized: '看下供应商或供应商编号的库存',
    matches: [{ term: '供应商信息', value: '供应商或供应商编号', start: 3, end: 8 }],
    ...overrides,
  }
}

function setup(result: TermNormalizeResult | Error = applied(), sent = true) {
  const review = vi.fn(async () => {
    if (result instanceof Error) throw result
    return result
  })
  const send = vi.fn(async () => sent)
  const gate = useTermNormalize({ api: { review } as TermNormalizeApi, send })
  return { gate, review, send }
}

describe('useTermNormalize · 预检', () => {
  it('未发生替换 → 不弹窗、不发送（交回调用方继续原链路）', async () => {
    const { gate, send } = setup(
      applied({ applied: false, normalized: PAYLOAD.content, matches: [] }),
    )

    await expect(
      gate.review({ content: PAYLOAD.content, payload: PAYLOAD, options: {} }),
    ).resolves.toBe(false)
    expect(gate.pendingTerm.value).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it('发生替换 → 打开弹窗并保留待发送载荷，此刻**不发送**', async () => {
    const { gate, send } = setup()

    await expect(
      gate.review({ content: PAYLOAD.content, payload: PAYLOAD, options: {} }),
    ).resolves.toBe(true)
    expect(gate.pendingTerm.value).toEqual({
      original: PAYLOAD.content,
      normalized: '看下供应商或供应商编号的库存',
      matches: [{ term: '供应商信息', value: '供应商或供应商编号', start: 3, end: 8 }],
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('预检失败（断网 / 未选数字人）→ 按原话继续，不阻断', async () => {
    const { gate } = setup(new Error('boom'))
    await expect(
      gate.review({ content: PAYLOAD.content, payload: PAYLOAD, options: {} }),
    ).resolves.toBe(false)
  })

  it(`超时（>${REVIEW_TIMEOUT_MS}ms）→ 按原话继续`, async () => {
    vi.useFakeTimers()
    try {
      const review = vi.fn(
        (_content: string, signal?: AbortSignal) =>
          new Promise<TermNormalizeResult>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      )
      const gate = useTermNormalize({ api: { review } as TermNormalizeApi, send: vi.fn() })

      const pending = gate.review({ content: 'x', payload: PAYLOAD, options: {} })
      await vi.advanceTimersByTimeAsync(REVIEW_TIMEOUT_MS)
      await expect(pending).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useTermNormalize · 用户选择', () => {
  it('使用替换后 → 一次发送：content 为替换文，且不另送原话（展示与提交同源）', async () => {
    const { gate, send } = setup()
    await gate.review({
      content: PAYLOAD.content,
      payload: PAYLOAD,
      options: { settleBeforeReturn: false },
    })

    await gate.onUseReplacement()

    expect(send).toHaveBeenCalledTimes(1)
    // 假发送未声明入参形状，按真实签名取回调用参数（断言内容见下）
    const calls = send.mock.calls as unknown as Array<
      [Record<string, unknown>, { settleBeforeReturn?: boolean }]
    >
    expect(calls[0]![0]).toEqual({
      content: '看下供应商或供应商编号的库存',
      attachments: [],
      skipTermCheck: true,
    })
    // 2026-11-07：聊天区要显示替换结果 —— 提交什么就展示什么，不再回传原话
    expect('originalContent' in calls[0]![0]).toBe(false)
    expect(calls[0]![1]).toEqual({ settleBeforeReturn: false })
    expect(gate.pendingTerm.value).toBeNull()
  })

  it('按原话继续 → 一次发送：载荷不变（正文就是原话）', async () => {
    const { gate, send } = setup()
    await gate.review({ content: PAYLOAD.content, payload: PAYLOAD, options: {} })

    await gate.onKeepOriginal()

    expect(send).toHaveBeenCalledWith(
      { ...PAYLOAD, skipTermCheck: true },
      { settleBeforeReturn: false },
    )
    expect(gate.pendingTerm.value).toBeNull()
  })

  it('手动输入（调用方未指定返回时机）→ 仍按"发出即返回"发送，弹窗立刻关闭', async () => {
    const { gate, send } = setup()
    await gate.review({ content: PAYLOAD.content, payload: PAYLOAD, options: {} })

    await gate.onUseReplacement()

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ content: '看下供应商或供应商编号的库存' }),
      { settleBeforeReturn: false },
    )
    expect(gate.pendingTerm.value).toBeNull()
  })

  it('发送被本地拦下（返回 false）→ 弹窗保留，用户可改选', async () => {
    const { gate, send } = setup(applied(), false)
    await gate.review({ content: PAYLOAD.content, payload: PAYLOAD, options: {} })

    await gate.onUseReplacement()

    expect(send).toHaveBeenCalledTimes(1)
    expect(gate.pendingTerm.value).not.toBeNull()
  })

  it('弹窗里编辑后的文本 → 作为正文发送（气泡与历史同源）', async () => {
    const { gate, send } = setup()
    await gate.review({ content: PAYLOAD.content, payload: PAYLOAD, options: {} })

    await gate.onUseReplacement('  看下钢材库存，按仓库分组  ')

    expect(send).toHaveBeenCalledWith(
      {
        content: '看下钢材库存，按仓库分组',
        attachments: [],
        // 2026-11-07：手改后的文本既提交给模型，也是聊天区显示的那一条
        skipTermCheck: true,
      },
      { settleBeforeReturn: false },
    )
    expect(gate.pendingTerm.value).toBeNull()
  })

  it('编辑为空 / 纯空白 → 不发送、弹窗保留（MUST NOT 发空消息）', async () => {
    const { gate, send } = setup()
    await gate.review({ content: PAYLOAD.content, payload: PAYLOAD, options: {} })

    await gate.onUseReplacement('   \n ')

    expect(send).not.toHaveBeenCalled()
    expect(gate.pendingTerm.value).not.toBeNull()
    // 未进入发送态：用户还能继续改，或改选"按原话"
    expect(gate.termSending.value).toBe(false)
  })

  it('空文本被拦下后，改为有效文本仍能正常发出（拦下不锁死弹窗）', async () => {
    const { gate, send } = setup()
    await gate.review({ content: PAYLOAD.content, payload: PAYLOAD, options: {} })

    await gate.onUseReplacement('')
    await gate.onUseReplacement('重新编辑后的文本')

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: '重新编辑后的文本' }), {
      settleBeforeReturn: false,
    })
    expect(gate.pendingTerm.value).toBeNull()
  })

  it('连点只发一次（发送中即返回）', async () => {
    let release: () => void = () => undefined
    const send = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true)
        }),
    )
    const gate = useTermNormalize({
      api: { review: vi.fn(async () => applied()) } as TermNormalizeApi,
      send,
    })
    await gate.review({ content: PAYLOAD.content, payload: PAYLOAD, options: {} })

    const first = gate.onUseReplacement()
    void gate.onUseReplacement()
    release()
    await first

    expect(send).toHaveBeenCalledTimes(1)
  })
})
