/**
 * US7 内容跳转与右侧预览 + US8 会话搜索与工作空间 —— **真实后端**。
 *
 * 重点验证：
 * - 外链直接跳转且**不改动**预览目标（V-10）
 * - 文本预览的真实往返：上传内容 == `fetch` 回来的内容
 * - 预览上限（默认 10MB）→ 真实 `413` → 错误态 + 下载引导（FR-048）
 * - `.xlsx` 等不支持内联的类型 → 回退下载（V-11）
 * - 工作空间固定 9 个目录且顺序与常量一致（SC-021）
 */
import { mount } from '@vue/test-utils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import WorkspaceDrawer from '../../src/components/chat/WorkspaceDrawer.vue'
import { SPACE_DIRECTORIES } from '../../src/constants/directories'
import {
  createLiveSession,
  makeLargeFile,
  makeLiveFile,
  selectAgent,
  until,
  type LiveSession,
} from './harness'

const AGENT = 'demo2'
const DIR = '生产计划'
const CSV_CONTENT = 'k1,k2\nv1,v2\n'

let live: LiveSession
/** 上传后的落盘名（供预览断言） */
const saved: Record<string, string> = {}

async function uploadAndRemember(key: string, file: File, dir = DIR): Promise<string> {
  await live.session.uploads.upload(dir, [file])
  const item = live.session.uploads.items.value.find((entry) => entry.name === file.name)
  if (!item?.serverFilename) throw new Error(`上传失败：${file.name}（${item?.error?.code ?? '未知'}）`)
  saved[key] = item.serverFilename
  return item.serverFilename
}

describe('US7 跳转与右侧预览（真实后端）', () => {
  beforeAll(async () => {
    live = createLiveSession()
    await selectAgent(live, AGENT)
    await uploadAndRemember('csv', makeLiveFile('itest-live-preview.csv', CSV_CONTENT))
    await uploadAndRemember('pdf', makeLiveFile('itest-live-doc.pdf', '%PDF-1.4\n%%EOF\n', 'application/pdf'))
    await uploadAndRemember('xlsx', makeLiveFile('itest-live-fake.xlsx', 'junk', 'application/vnd.ms-excel'))
    await uploadAndRemember(
      'bigPdf',
      makeLargeFile('itest-live-preview-big.pdf', 11 * 1024 * 1024, 'application/pdf'),
    )
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  it('外链：直接跳转且不改动预览目标（V-10 / FR-045）', () => {
    const { preview } = live.session
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    preview.openLink('https://example.com/itest')

    expect(openSpy).toHaveBeenCalledWith('https://example.com/itest', '_blank', 'noopener,noreferrer')
    expect(preview.target.value.kind).toBe('none')
  })

  it('文本预览：fetch 回的内容与上传内容一致（真实往返）', async () => {
    const { preview } = live.session

    await preview.openFile({ dir: DIR, filename: saved.csv ?? '' })

    expect(preview.target.value.kind).toBe('file')
    expect(preview.content.value?.renderMode).toBe('text')
    expect(preview.content.value?.text).toBe(CSV_CONTENT)
    expect(preview.loading.value).toBe(false)
  })

  it('PDF：走内联 iframe 直链，且该直链真实可用', async () => {
    const { preview } = live.session

    await preview.openFile({ dir: DIR, filename: saved.pdf ?? '' })

    expect(preview.content.value?.renderMode).toBe('pdf')
    const url = preview.content.value?.url ?? ''
    expect(url).toContain('/api/files/preview')
    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/pdf')
  })

  it('超过预览上限：PDF 与文本类都落到错误态 + 下载引导（FR-048）', async () => {
    const { preview } = live.session

    // `.pdf`：预检拿到真实 413 → 不再交给 iframe，直接错误态 + 下载引导
    await preview.openFile({ dir: DIR, filename: saved.bigPdf ?? '' })
    expect(preview.content.value?.renderMode).toBe('error')
    expect(preview.content.value?.error?.code).toBe('FILE_TOO_LARGE')
    expect(preview.content.value?.url ?? '').toContain('/api/files/download')

    // 文本类：真正 fetch 内容 → 同样落到错误态
    await uploadAndRemember(
      'bigCsv',
      makeLargeFile('itest-live-preview-big.csv', 11 * 1024 * 1024, 'text/csv'),
    )
    await preview.openFile({ dir: DIR, filename: saved.bigCsv ?? '' })
    expect(preview.content.value?.renderMode).toBe('error')
    expect(preview.content.value?.error?.code).toBe('FILE_TOO_LARGE')
    expect(preview.content.value?.url ?? '').toContain('/api/files/download')
  })

  it('不支持内联的类型 → 回退下载（V-11）', async () => {
    const { preview } = live.session

    await preview.openFile({ dir: DIR, filename: saved.xlsx ?? '' })

    expect(preview.content.value?.renderMode).toBe('download')
    expect(preview.content.value?.url ?? '').toContain('/api/files/download')
  })

  it('文件不存在 → 404 错误态（FR-048）', async () => {
    const { preview } = live.session

    await preview.openFile({ dir: DIR, filename: 'itest-live-not-exist.csv' })

    expect(preview.content.value?.renderMode).toBe('error')
    expect(preview.content.value?.error?.code).toBe('FILE_NOT_FOUND')
  })

  it('下载：走 <a download> 直链且不改动预览目标（FR-047）', () => {
    const { preview } = live.session
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const targetBefore = JSON.stringify(preview.target.value)

    preview.download({ dir: DIR, filename: saved.csv ?? '' })

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(preview.target.value)).toBe(targetBefore)
  })

  it('close 收起预览区', async () => {
    const { preview } = live.session
    await preview.openFile({ dir: DIR, filename: saved.csv ?? '' })
    preview.close()
    expect(preview.target.value.kind).toBe('none')
    expect(preview.content.value).toBeNull()
  })
})

describe('US8 会话搜索与工作空间（真实后端）', () => {
  it('关键词命中 + 循环跳转 + 空关键词（FR-029/030）', async () => {
    const { threads, search } = live.session
    await threads.loadList()
    const seeded = threads.list.value.find((item) => (item.title ?? '').startsWith('itest-'))
    if (!seeded) throw new Error('需要先跑 prepare-integration-data.ts all')
    await threads.select(seeded.thread_id)

    search.open()
    expect(search.isOpen.value).toBe(true)

    search.keyword.value = '联调样本'
    await until(() => search.total.value > 0, '命中搜索结果')
    // 只搜索"已加载"的消息（首屏 50 条），故断言与实际加载量自洽即可
    expect(search.total.value).toBeGreaterThan(0)
    expect(search.matches.value.length).toBe(search.total.value)

    search.next()
    const start = search.activeIndex.value
    expect(start).toBeGreaterThanOrEqual(0)

    // 循环定位：走满 total 步应回到同一项（FR-030）
    for (let step = 0; step < search.total.value; step += 1) search.next()
    expect(search.activeIndex.value).toBe(start)

    search.keyword.value = ''
    await until(() => search.total.value === 0, '清空关键词后无匹配')

    search.close()
    expect(search.isOpen.value).toBe(false)
  })

  it('工作空间：固定 9 个目录且顺序与常量一致（FR-031 / SC-021）', async () => {
    const { workspace } = live.session

    await workspace.load()

    expect(workspace.dirs.value.map((item) => item.dir)).toEqual(
      SPACE_DIRECTORIES.map((item) => item.dir),
    )
    const files = workspace.filesOf(DIR).map((file) => file.filename)
    expect(files.some((name) => name.startsWith('itest-live-'))).toBe(true)
    expect(workspace.filesOf('tmp')).toBeInstanceOf(Array)
  })

  it('工作空间抽屉渲染真实 9 个目录（FR-031）', async () => {
    const { workspace } = live.session
    await workspace.load()

    const wrapper = mount(WorkspaceDrawer, {
      props: { open: true, dirs: workspace.dirs.value },
    })

    for (const directory of SPACE_DIRECTORIES) {
      expect(wrapper.text()).toContain(directory.label)
    }
  })

  it('空目录渲染空态提示（FR-019）', () => {
    const wrapper = mount(WorkspaceDrawer, {
      props: { open: true, dirs: [{ dir: '生产计划', files: [] }] },
    })
    expect(wrapper.text()).toContain('该目录暂无文件')
  })
})
