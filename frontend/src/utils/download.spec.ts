/**
 * 单元测试：浏览器下载（2026-10-16，宪章偏差纠正——原缺同名测试）。
 *
 * 单独成文件的唯一理由就是"让 DOM 这一跳只发生在一处"，故本测试必须把这一跳的每一步钉住：
 * `Blob` 的类型与内容、`<a download>` 的两个属性、**锚点点击时确实挂在文档里**
 * （游离节点上的 `click()` 在真实浏览器里什么都不会发生）、点击后移除、
 * 以及对象 URL **延后一轮任务**撤销（立刻撤销会让部分浏览器来不及取数据）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadTextFile } from './download'

/** 点击那一刻锚点必须已在文档里，故在 click 的桩里取快照 */
let anchorAtClick: Element | null = null
let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>

function installUrlStubs(): void {
  createObjectURL = vi.fn(() => 'blob:mock')
  revokeObjectURL = vi.fn()
  Object.assign(URL, { createObjectURL, revokeObjectURL })
}

/** 取回被交给 `createObjectURL` 的 Blob（顺便验证它确实是 Blob） */
function createdBlob(): Blob {
  const blob: unknown = createObjectURL.mock.calls[0][0]
  expect(blob).toBeInstanceOf(Blob)
  return blob as Blob
}

describe('downloadTextFile —— 落盘的唯一一跳（2026-10-16）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    anchorAtClick = null
    installUrlStubs()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      anchorAtClick = document.body.querySelector('a[download]')
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('内容与文件名经 Blob + <a download> 落地，默认 MIME 为 Markdown', async () => {
    downloadTextFile('生产计划复核.md', '# 标题\n')

    const blob = createdBlob()
    expect(blob.type).toBe('text/markdown;charset=utf-8')
    await expect(blob.text()).resolves.toBe('# 标题\n')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('锚点在**点击那一刻**已挂在 document.body 上（游离节点点击无效）', () => {
    downloadTextFile('a.md', 'x')

    const anchor = anchorAtClick as HTMLAnchorElement | null
    expect(anchor).not.toBeNull()
    expect(anchor?.download).toBe('a.md')
    expect(anchor?.href).toBe('blob:mock')
  })

  it('点击后锚点被移除（不在 DOM 里留垃圾节点）', () => {
    downloadTextFile('a.md', 'x')

    expect(document.body.querySelector('a[download]')).toBeNull()
  })

  it('对象 URL 不在同一次调用里撤销，而是延后一轮任务', () => {
    downloadTextFile('a.md', 'x')

    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.advanceTimersByTime(0)

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('MIME 可覆盖（非 Markdown 的落地场景复用同一条链路）', () => {
    downloadTextFile('data.json', '{}', 'application/json')

    expect(createdBlob().type).toBe('application/json')
  })
})
