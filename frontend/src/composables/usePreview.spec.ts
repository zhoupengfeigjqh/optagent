/**
 * 单测：右侧面板的跳转分流（`openView`，2026-10-15 统一口径）
 *
 * 守四件事：
 * 1. **异源直跳不进面板** —— `window.open`，面板状态一个字节不动（V-10）
 * 2. **同源按预检结论分派** —— `renderable` → iframe；`download` → 下载入口；
 *    `fallback` → 收起面板 + 外跳（不让用户停在一个空面板上）
 * 3. **`kind:'file'` 走文件口径** —— 与"在文件空间里点文件"同一套（这里用不上响应头预检）
 * 4. **脏负载的降级** —— `kind:'file'` 却没有 `filePath` 时退回地址预检，不硬拆地址当路径
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FilesApi } from '../api/files'
import { probeRenderable } from '../utils/preview-probe'
import { createPreviewStore } from './usePreview'

vi.mock('../utils/preview-probe', () => ({ probeRenderable: vi.fn() }))

const ORIGIN = window.location.origin
const probe = vi.mocked(probeRenderable)

/** 文件接口桩：只区分"哪个方法被调用、返回什么"，不模拟后端。 */
function filesStub(over: Partial<FilesApi> = {}): FilesApi {
  return {
    upload: vi.fn(),
    list: vi.fn(),
    downloadUrl: (dir: string, filename: string) =>
      `/api/files/download?dir=${dir}&filename=${filename}`,
    previewUrl: (dir: string, filename: string) =>
      `/api/files/preview?dir=${dir}&filename=${filename}`,
    fetchPreviewText: vi.fn().mockResolvedValue('一车间 120 件'),
    probePreview: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(),
    workspace: vi.fn(),
    rules: vi.fn(),
    ...over,
  } as unknown as FilesApi
}

beforeEach(() => {
  probe.mockReset()
})

describe('openView —— 异源地址（V-10）', () => {
  it('新窗口直跳，且**不改动**面板状态', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const store = createPreviewStore({ files: filesStub() })
    store.openList()

    await store.openView({ url: 'http://other:8080/x', name: '别处', kind: 'url' })

    expect(open).toHaveBeenCalledWith('http://other:8080/x', '_blank', 'noopener,noreferrer')
    expect(store.open.value).toBe(true)
    expect(store.view.value).toBe('list')
    expect(store.target.value).toEqual({ kind: 'none' })
    // 跨域读不到响应头，预检**不该**发出去
    expect(probe).not.toHaveBeenCalled()
    open.mockRestore()
  })
})

describe('openView —— 同源地址（预检后分派）', () => {
  it('`renderable` → 面板进内容态，目标带 `renderMode: iframe`', async () => {
    probe.mockResolvedValue('renderable')
    const store = createPreviewStore({ files: filesStub() })

    await store.openView({
      url: `${ORIGIN}/taskresult?taskNo=1`,
      name: '产品周报.html',
      kind: 'url',
    })

    expect(store.open.value).toBe(true)
    expect(store.view.value).toBe('content')
    expect(store.loading.value).toBe(false)
    expect(store.target.value).toEqual({
      kind: 'url',
      url: `${ORIGIN}/taskresult?taskNo=1`,
      name: '产品周报.html',
      renderMode: 'iframe',
    })
  })

  it('`download` → `renderMode: download`，**不**直接跳走（面板给用户一个入口）', async () => {
    probe.mockResolvedValue('download')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const store = createPreviewStore({ files: filesStub() })

    await store.openView({
      url: `${ORIGIN}/api/files/download?filename=x.xlsx`,
      name: 'x.xlsx',
      kind: 'url',
    })

    expect(store.target.value).toMatchObject({ kind: 'url', renderMode: 'download' })
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('`fallback`（网络错误 / 非 2xx）→ 收起面板 + 外部跳转', async () => {
    probe.mockResolvedValue('fallback')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const store = createPreviewStore({ files: filesStub() })

    await store.openView({ url: `${ORIGIN}/x`, name: 'x', kind: 'url' })

    expect(store.open.value).toBe(false)
    expect(store.view.value).toBe('list')
    expect(open).toHaveBeenCalledWith(`${ORIGIN}/x`, '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })
})

describe('openView —— kind:file（与「文件空间点文件」同一口径）', () => {
  it('文本类：不预检，前端 `fetch` 正文后用 `content` 渲染（不是 iframe 裸文本）', async () => {
    const files = filesStub()
    const store = createPreviewStore({ files })

    await store.openView({
      url: `${ORIGIN}/api/files/preview?dir=a&filename=b`,
      name: '9月计划.txt',
      kind: 'file',
      filePath: '数据准备/9月计划.txt',
    })

    expect(probe).not.toHaveBeenCalled()
    expect(store.target.value).toEqual({ kind: 'file', dir: '数据准备', filename: '9月计划.txt' })
    expect(files.fetchPreviewText).toHaveBeenCalledWith('数据准备', '9月计划.txt')
    expect(store.content.value).toEqual({
      renderMode: 'text',
      text: '一车间 120 件',
      url: null,
      error: null,
    })
  })

  it('.xlsx → 下载引导（按扩展名，而不是按响应头）', async () => {
    const store = createPreviewStore({ files: filesStub() })

    await store.openView({
      url: `${ORIGIN}/api/files/preview?dir=a&filename=b`,
      name: '9月计划.xlsx',
      kind: 'file',
      filePath: '数据准备/生产计划/9月计划.xlsx',
    })

    expect(probe).not.toHaveBeenCalled()
    expect(store.target.value).toEqual({
      kind: 'file',
      dir: '数据准备/生产计划',
      filename: '9月计划.xlsx',
    })
    expect(store.content.value?.renderMode).toBe('download')
  })

  it('.pdf → 先探预览可用性（后端结构化错误）再进 iframe', async () => {
    const files = filesStub()
    const store = createPreviewStore({ files })

    await store.openView({
      url: `${ORIGIN}/api/files/preview?dir=a&filename=b`,
      name: 'x.pdf',
      kind: 'file',
      filePath: '共享空间/x.pdf',
    })

    expect(files.probePreview).toHaveBeenCalledWith('共享空间', 'x.pdf')
    expect(store.content.value?.renderMode).toBe('pdf')
    expect(store.content.value?.error).toBeNull()
  })

  it('脏负载：`kind:file` 却没有 `filePath` → 退回地址预检，不拿地址硬拆路径', async () => {
    probe.mockResolvedValue('renderable')
    const store = createPreviewStore({ files: filesStub() })

    await store.openView({ url: `${ORIGIN}/x`, name: 'x', kind: 'file' })

    expect(probe).toHaveBeenCalledWith(`${ORIGIN}/x`)
    expect(store.target.value).toMatchObject({ kind: 'url' })
  })
})

/** 可手动结算的 promise（只为构造"先发后到"的竞态）。 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('openFile —— 内容态分派与错误态（FR-048 / V-11）', () => {
  it('图片：先探可用性，再给 `<img>` 直链', async () => {
    const files = filesStub()
    const store = createPreviewStore({ files })

    await store.openFile({ dir: '共享空间', filename: 'a.png' })

    expect(files.probePreview).toHaveBeenCalledWith('共享空间', 'a.png')
    expect(store.target.value).toEqual({ kind: 'file', dir: '共享空间', filename: 'a.png' })
    expect(store.content.value?.renderMode).toBe('image')
    expect(store.content.value?.url).toContain('/api/files/preview')
  })

  it('文本类读取失败（404/413）→ 错误态 + 下载引导，不留白屏', async () => {
    const files = filesStub({
      fetchPreviewText: vi.fn().mockRejectedValue(new Error('404')),
    })
    const store = createPreviewStore({ files })

    await store.openFile({ dir: '数据准备', filename: 'x.csv' })

    expect(store.content.value?.renderMode).toBe('error')
    expect(store.content.value?.error).not.toBeNull()
    expect(store.content.value?.url).toContain('/api/files/download')
    expect(store.loading.value).toBe(false)
  })

  it('.pdf 预检失败 → 错误态（不让 iframe 渲染成浏览器错误页）', async () => {
    const files = filesStub({
      probePreview: vi.fn().mockRejectedValue(new Error('413')),
    })
    const store = createPreviewStore({ files })

    await store.openFile({ dir: '共享空间', filename: 'big.pdf' })

    expect(store.content.value?.renderMode).toBe('error')
    expect(store.content.value?.url).toContain('/api/files/download')
  })

  it('2026-10-20：.html 与 PDF 同路径 —— 先预检，再给 iframe 直链', async () => {
    const files = filesStub()
    const store = createPreviewStore({ files })

    await store.openFile({ dir: '共享空间', filename: '看板.html' })

    expect(files.probePreview).toHaveBeenCalledWith('共享空间', '看板.html')
    expect(store.content.value?.renderMode).toBe('html')
    expect(store.content.value?.url).toContain('/api/files/preview')
  })

  it('2026-10-20：.html 预览失败（超限）→ 错误态 + 下载引导', async () => {
    const files = filesStub({
      probePreview: vi.fn().mockRejectedValue(new Error('413')),
    })
    const store = createPreviewStore({ files })

    await store.openFile({ dir: '共享空间', filename: 'big.html' })

    expect(store.content.value?.renderMode).toBe('error')
    expect(store.content.value?.url).toContain('/api/files/download')
  })
})

describe('openList / backToList / close —— 面板状态收敛', () => {
  it('`backToList` 退回列表态但**不收起**面板，并清掉上一份内容', async () => {
    const store = createPreviewStore({ files: filesStub() })
    await store.openFile({ dir: '数据准备', filename: 'x.txt' })

    store.backToList()

    expect(store.open.value).toBe(true)
    expect(store.view.value).toBe('list')
    expect(store.target.value).toEqual({ kind: 'none' })
    expect(store.content.value).toBeNull()
  })

  it('`close` 收起面板并清内容（视图回列表，避免下次展开停在旧目标）', async () => {
    const store = createPreviewStore({ files: filesStub() })
    await store.openFile({ dir: '数据准备', filename: 'x.txt' })

    store.close()

    expect(store.open.value).toBe(false)
    expect(store.view.value).toBe('list')
    expect(store.content.value).toBeNull()
  })

  it('`onFileRemoved`：正在看的就是它 → 退回列表；看的是别的文件 → 不动', async () => {
    const store = createPreviewStore({ files: filesStub() })
    await store.openFile({ dir: '数据准备', filename: 'x.txt' })

    store.onFileRemoved({ dir: '数据准备', filename: 'other.txt' })
    expect(store.view.value).toBe('content')

    store.onFileRemoved({ dir: '数据准备', filename: 'x.txt' })
    expect(store.view.value).toBe('list')
    expect(store.target.value).toEqual({ kind: 'none' })
  })

  it('`download`：以 `<a download>` 直链触发（不经 `fetch`，无大小上限）', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const store = createPreviewStore({ files: filesStub() })

    store.download({ dir: '数据准备', filename: 'x.xlsx' })

    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })
})

describe('openView —— 竞态（后发覆盖先发）', () => {
  it('预检还在飞时又点了一个：旧的结论不回填', async () => {
    const first = deferred<'renderable' | 'download' | 'fallback'>()
    probe.mockReturnValueOnce(first.promise)
    probe.mockResolvedValueOnce('download')

    const store = createPreviewStore({ files: filesStub() })
    const slow = store.openView({ url: `${ORIGIN}/a`, name: 'A', kind: 'url' })
    const fast = store.openView({ url: `${ORIGIN}/b`, name: 'B', kind: 'url' })

    await fast
    first.resolve('renderable')
    await slow

    expect(store.target.value).toMatchObject({ url: `${ORIGIN}/b`, renderMode: 'download' })
  })
})

/**
 * 放大态（2026-10-16，011）
 *
 * 守三件事：
 * 1. **可放大判据只有一处**（`maximizable`）——"有版面"的三类可放大，其余五态一律不可（FR-010 / FR-013）；
 * 2. **出口永远在**（`maximizeToggleVisible = maximized || maximizable`）——放大态下切到加载中的目标时
 *    不能出现"缩小按钮消失"（FR-005）；
 * 3. **放大态是纯呈现** —— 不发请求、不落盘，且 `close` / `backToList` / `openList` 三条路径一律归零，
 *    而 `openFile` / `openView` 换目标时保持（FR-006 / FR-007 / FR-012）。
 */
describe('放大态 —— 可放大判据与收敛（011）', () => {
  /** 进"同源 iframe 页面"内容态。 */
  async function storeOnIframe(): Promise<ReturnType<typeof createPreviewStore>> {
    probe.mockResolvedValue('renderable')
    const store = createPreviewStore({ files: filesStub() })
    await store.openView({ url: `${ORIGIN}/taskresult?taskNo=1`, name: '周报.html', kind: 'url' })
    return store
  }

  it('默认不是放大态，且入口在有版面之前不出现', () => {
    const store = createPreviewStore({ files: filesStub() })

    expect(store.maximized.value).toBe(false)
    expect(store.maximizable.value).toBe(false)
    expect(store.maximizeToggleVisible.value).toBe(false)
  })

  it('① 同源 `viewUrl` 的 iframe 页面 → 可放大', async () => {
    const store = await storeOnIframe()

    expect(store.maximizable.value).toBe(true)
    expect(store.maximizeToggleVisible.value).toBe(true)
  })

  it('② 本地 PDF → 可放大', async () => {
    const store = createPreviewStore({ files: filesStub() })
    await store.openFile({ dir: '共享空间', filename: '图纸.pdf' })

    expect(store.maximizable.value).toBe(true)
  })

  it('③ 本地图片 → 可放大', async () => {
    const store = createPreviewStore({ files: filesStub() })
    await store.openFile({ dir: '共享空间', filename: '现场.png' })

    expect(store.maximizable.value).toBe(true)
  })

  it('③b 本地 HTML → 可放大（有版面，与 PDF 同口径，2026-10-20）', async () => {
    const store = createPreviewStore({ files: filesStub() })
    await store.openFile({ dir: '共享空间', filename: '看板.html' })

    expect(store.content.value?.renderMode).toBe('html')
    expect(store.maximizable.value).toBe(true)
  })

  it('④ 纯文本 → **不可**放大（文本不因变宽更可读，零变化边界）', async () => {
    const store = createPreviewStore({ files: filesStub() })
    await store.openFile({ dir: '数据准备', filename: '9月计划.txt' })

    expect(store.content.value?.renderMode).toBe('text')
    expect(store.maximizable.value).toBe(false)
    expect(store.maximizeToggleVisible.value).toBe(false)
  })

  it('⑤ 同源但预检为「需下载」的入口 → **不可**放大', async () => {
    probe.mockResolvedValue('download')
    const store = createPreviewStore({ files: filesStub() })
    await store.openView({ url: `${ORIGIN}/api/files/download?x=1`, name: 'x.xlsx', kind: 'url' })

    expect(store.target.value).toMatchObject({ kind: 'url', renderMode: 'download' })
    expect(store.maximizable.value).toBe(false)
  })

  it('⑤b 不支持内联的文件类型（`.xlsx`）→ **不可**放大', async () => {
    const store = createPreviewStore({ files: filesStub() })
    await store.openFile({ dir: '数据准备', filename: '9月计划.xlsx' })

    expect(store.content.value?.renderMode).toBe('download')
    expect(store.maximizable.value).toBe(false)
  })

  it('⑥ 错误态（读取失败）→ **不可**放大', async () => {
    const files = filesStub({ fetchPreviewText: vi.fn().mockRejectedValue(new Error('413')) })
    const store = createPreviewStore({ files })
    await store.openFile({ dir: '数据准备', filename: 'x.csv' })

    expect(store.content.value?.renderMode).toBe('error')
    expect(store.maximizable.value).toBe(false)
  })

  it('⑦ 文件空间列表态 → **不可**放大', () => {
    const store = createPreviewStore({ files: filesStub() })
    store.openList()

    expect(store.open.value).toBe(true)
    expect(store.maximizable.value).toBe(false)
  })

  it('⑧ 内容态但目标为空（预检中）→ 不可放大，且此时入口也不出现', async () => {
    const gate = deferred<'renderable' | 'download' | 'fallback'>()
    probe.mockReturnValueOnce(gate.promise)
    const store = createPreviewStore({ files: filesStub() })

    const pending = store.openView({ url: `${ORIGIN}/x`, name: 'X', kind: 'url' })

    expect(store.view.value).toBe('content')
    expect(store.target.value).toEqual({ kind: 'none' })
    expect(store.maximizable.value).toBe(false)
    expect(store.maximizeToggleVisible.value).toBe(false)

    gate.resolve('renderable')
    await pending
  })

  it('越权 `toggleMaximize`：不可放大时不进入放大态', () => {
    const store = createPreviewStore({ files: filesStub() })

    store.toggleMaximize()

    expect(store.maximized.value).toBe(false)
  })

  it('放大 ↔ 缩小：同一入口翻转；`restoreMaximize` 幂等', async () => {
    const store = await storeOnIframe()

    store.toggleMaximize()
    expect(store.maximized.value).toBe(true)

    store.toggleMaximize()
    expect(store.maximized.value).toBe(false)

    store.restoreMaximize()
    expect(store.maximized.value).toBe(false)
  })

  it('放大态下切到「预检中」的目标：出口不消失，且**保持**放大（I1 / FR-005 / FR-012）', async () => {
    const store = await storeOnIframe()
    store.toggleMaximize()

    const gate = deferred<'renderable' | 'download' | 'fallback'>()
    probe.mockReturnValueOnce(gate.promise)
    const pending = store.openView({ url: `${ORIGIN}/b`, name: 'B', kind: 'url' })

    expect(store.maximizable.value).toBe(false) // 预检中：内容还不存在
    expect(store.maximizeToggleVisible.value).toBe(true) // 但出口必须还在

    gate.resolve('renderable')
    await pending

    expect(store.maximized.value).toBe(true)
    expect(store.maximizable.value).toBe(true)
  })

  it('`close` / `backToList` / `openList` 三条路径一律退出放大（I2 / FR-007 / FR-032）', async () => {
    const closed = createPreviewStore({ files: filesStub() })
    await closed.openFile({ dir: '共享空间', filename: 'a.pdf' })
    closed.toggleMaximize()
    closed.close()
    expect(closed.maximized.value).toBe(false)

    const back = createPreviewStore({ files: filesStub() })
    await back.openFile({ dir: '共享空间', filename: 'a.pdf' })
    back.toggleMaximize()
    back.backToList()
    expect(back.maximized.value).toBe(false)

    const list = createPreviewStore({ files: filesStub() })
    await list.openFile({ dir: '共享空间', filename: 'a.pdf' })
    list.toggleMaximize()
    list.openList()
    expect(list.maximized.value).toBe(false)
  })

  it('正在看的文件被删除（`onFileRemoved`）→ 连同放大态一起退出（FR-032）', async () => {
    const store = createPreviewStore({ files: filesStub() })
    await store.openFile({ dir: '共享空间', filename: 'a.pdf' })
    store.toggleMaximize()

    store.onFileRemoved({ dir: '共享空间', filename: 'a.pdf' })

    expect(store.view.value).toBe('list')
    expect(store.maximized.value).toBe(false)
  })

  it('放大 / 缩小 MUST NOT 产生任何请求（FR-006 的零副作用侧面）', async () => {
    const files = filesStub()
    const store = createPreviewStore({ files })
    await store.openFile({ dir: '共享空间', filename: 'a.pdf' })

    const before = [
      vi.mocked(files.probePreview).mock.calls.length,
      vi.mocked(files.fetchPreviewText).mock.calls.length,
    ]

    store.toggleMaximize()
    store.restoreMaximize()

    expect([
      vi.mocked(files.probePreview).mock.calls.length,
      vi.mocked(files.fetchPreviewText).mock.calls.length,
    ]).toEqual(before)
  })
})
