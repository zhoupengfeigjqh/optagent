/**
 * 单测：剪贴板复制降级链（028 修复）。
 *
 * - Clipboard API 可用且成功 → `true`；
 * - Clipboard API 抛错（权限拒绝）→ 落入 execCommand 降级；
 * - 两者都不可用（jsdom 缺省形态）→ `false`，调用方负责手动复制兜底。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard } from './clipboard'

const writeText = vi.fn<(text: string) => Promise<void>>()
const execCommand = vi.fn<(command: string) => boolean>()

function stubClipboard(value: unknown): void {
  Object.defineProperty(window.navigator, 'clipboard', { value, configurable: true })
}

function stubExecCommand(): void {
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
}

afterEach(() => {
  stubClipboard(undefined)
  Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true })
  vi.clearAllMocks()
})

describe('copyToClipboard —— 降级链', () => {
  it('Clipboard API 成功 → true，且不走 execCommand', async () => {
    writeText.mockResolvedValue(undefined)
    stubClipboard({ writeText })
    stubExecCommand()
    await expect(copyToClipboard('http://x/r?link=1')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('http://x/r?link=1')
    expect(execCommand).not.toHaveBeenCalled()
  })

  it('Clipboard API 抛错 → execCommand 降级成功', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    stubClipboard({ writeText })
    execCommand.mockReturnValue(true)
    stubExecCommand()
    await expect(copyToClipboard('http://x/r?link=2')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('clipboard 不存在（非安全上下文）且 execCommand 失败 → false', async () => {
    stubClipboard(undefined)
    execCommand.mockReturnValue(false)
    stubExecCommand()
    await expect(copyToClipboard('http://x/r?link=3')).resolves.toBe(false)
  })

  it('两套 API 均不存在（jsdom 缺省）→ false 不抛错', async () => {
    await expect(copyToClipboard('http://x/r?link=4')).resolves.toBe(false)
  })
})
