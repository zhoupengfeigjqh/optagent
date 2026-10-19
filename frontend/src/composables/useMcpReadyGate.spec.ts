/**
 * 单元测试：发送前的 MCP 就绪门（2026-10-18）。
 *
 * 守住四条口径：
 * ① 没有灰色 → 零等待直接放行（稳态不增加任何延迟）；
 * ② 有灰色 → 等出结果再放行；
 * ③ 超时 → **仍然放行**（不因 MCP 挂掉而阻断聊天）+ 用户可感知提示；
 * ④ 等待期间 `preparing` 为真（输入区与发送入口靠它禁用，避免重复提交），结束后复位。
 */
import { describe, expect, it, vi } from 'vitest'

import { createMcpReadyGate, MCP_READY_TIMEOUT_MS } from './useMcpReadyGate'

function makeGate(options: {
  pending: boolean
  result?: Promise<boolean> | boolean
  throws?: boolean
}) {
  const toast = { push: vi.fn() }
  const waitForResult = vi.fn(async (_timeoutMs: number): Promise<boolean> => {
    if (options.throws === true) throw new Error('boom')
    return await (options.result ?? false)
  })
  const gate = createMcpReadyGate({
    hasPending: () => options.pending,
    waitForResult,
    toast,
  })
  return { gate, toast, waitForResult }
}

describe('createMcpReadyGate —— 发送前等待 MCP 出现连接结果', () => {
  it('没有灰色：直接放行，不等待、不提示、不进入等待态', async () => {
    const { gate, toast, waitForResult } = makeGate({ pending: false })

    await expect(gate.waitMcpReady()).resolves.toBe(true)

    expect(waitForResult).not.toHaveBeenCalled()
    expect(toast.push).not.toHaveBeenCalled()
    expect(gate.preparing.value).toBe(false)
  })

  it('有灰色且等到结果：放行，不提示', async () => {
    const { gate, toast, waitForResult } = makeGate({ pending: true, result: true })

    await expect(gate.waitMcpReady()).resolves.toBe(true)

    expect(waitForResult).toHaveBeenCalledWith(MCP_READY_TIMEOUT_MS)
    expect(toast.push).not.toHaveBeenCalled()
    expect(gate.preparing.value).toBe(false)
  })

  it('等待期间 preparing 为真，结束后复位（重复点击据此被挡）', async () => {
    let settle: ((ready: boolean) => void) | undefined
    const pendingResult = new Promise<boolean>((resolve) => {
      settle = resolve
    })
    const { gate } = makeGate({ pending: true, result: pendingResult })

    const running = gate.waitMcpReady()
    expect(gate.preparing.value).toBe(true)

    settle?.(true)
    await running
    expect(gate.preparing.value).toBe(false)
  })

  it('超时：仍然放行，并提示"本轮可能缺少相关工具"', async () => {
    const { gate, toast } = makeGate({ pending: true, result: false })

    await expect(gate.waitMcpReady()).resolves.toBe(true)

    expect(toast.push).toHaveBeenCalledWith('info', 'MCP 服务连接超时，本轮可能缺少相关工具')
    expect(gate.preparing.value).toBe(false)
  })

  it('等待过程抛错：按未等到处理，放行且不阻断发送（原则九）', async () => {
    const { gate, toast } = makeGate({ pending: true, throws: true })

    await expect(gate.waitMcpReady()).resolves.toBe(true)

    expect(toast.push).toHaveBeenCalledWith('info', 'MCP 服务连接超时，本轮可能缺少相关工具')
    expect(gate.preparing.value).toBe(false)
  })
})
