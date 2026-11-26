import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import type { FilesApi } from '../api/files'
import type { FileReference, WorkspaceResponse } from '../api/types'
import { mentionToken, type FileMentionStore, type MentionColumn } from './useFileMention'
import { useMentionComposer } from './useMentionComposer'
import type { ToastStore } from './useToast'
import { useUploadPanel } from './useUploadPanel'
import { createUploadsStore } from './useUploads'
import { createWorkspaceStore } from './useWorkspace'

const DIR = '数据准备/生产计划'
const TMP = '临时空间'

function workspaceResponse(): WorkspaceResponse {
  return {
    scenario: '生产计划',
    spaces: [
      {
        name: '数据准备',
        agent_writable: false,
        upload_extensions: ['.csv'],
        dirs: [
          {
            dir: DIR,
            label: '生产计划',
            deletable: true,
            files: [],
            fields: [],
            upload_extensions: ['.csv', '.xlsx'],
            predefined: false,
          },
        ],
      },
      {
        name: TMP,
        agent_writable: true,
        upload_extensions: ['.csv', '.png'],
        dirs: [
          {
            dir: TMP,
            label: TMP,
            deletable: true,
            files: [],
            fields: [],
            upload_extensions: ['.csv', '.png'],
            predefined: false,
          },
        ],
      },
    ],
  }
}

function file(name: string): File {
  return new File([new Uint8Array(8)], name, { type: 'text/csv' })
}

function echoUpload() {
  return vi
    .fn()
    .mockImplementation((_dir: string, _file: File, filename: string) =>
      Promise.resolve({ dir: TMP, filename, size: 8 }),
    )
}

async function setup(
  uploadImpl: ReturnType<typeof vi.fn> = vi.fn(),
  options: {
    referenceCount?: () => number
    toast?: ToastStore
    initialReferences?: FileReference[]
    thread?: string | null
    /** 临时空间现存文件名（发送时算重名用） */
    existing?: string[]
    accept?: (reference: FileReference) => boolean
    workspace?: WorkspaceResponse
    draft?: string
  } = {},
) {
  const toast = options.toast ?? ({ push: vi.fn() } as unknown as ToastStore)
  const uploads = createUploadsStore({
    files: { upload: uploadImpl } as unknown as FilesApi,
    toast: { push: vi.fn() } as unknown as ToastStore,
  })
  const workspace = createWorkspaceStore({
    files: {
      workspace: vi.fn().mockResolvedValue(options.workspace ?? workspaceResponse()),
    } as unknown as FilesApi,
    toast,
  })
  if (options.workspace === undefined) {
    await workspace.load()
  }

  const references = ref<FileReference[]>([...(options.initialReferences ?? [])])
  const acceptUpload = vi.fn((reference: FileReference) => {
    const ok = options.accept ? options.accept(reference) : true
    if (ok) references.value = [...references.value, reference]
    return ok
  })
  const agent = ref<string | null>('生产计划辅助')
  const thread = ref<string | null>(options.thread ?? null)
  const panel = useUploadPanel({
    uploads,
    workspace,
    acceptUpload,
    toast,
    referenceCount: options.referenceCount ?? (() => references.value.length),
    listFiles: options.existing
      ? vi.fn().mockResolvedValue(options.existing.map((filename) => ({ filename })))
      : undefined,
    references: () => references.value,
    agent: () => agent.value,
    thread: () => thread.value,
    draft: options.draft === undefined
      ? () => references.value.map((item) => mentionToken(item)).join(' ')
      : () => options.draft as string,
  })

  return { uploads, workspace, acceptUpload, panel, upload: uploadImpl, toast, references, agent, thread }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('useUploadPanel —— 开关与清空（FR-010 / FR-013 / FR-014）', () => {
  it('展开：目录已加载则不重复 load；收起再展开才重新拉', async () => {
    const { panel, workspace } = await setup()
    const load = vi.spyOn(workspace, 'load')

    panel.onToggleUpload()
    expect(panel.uploadOpen.value).toBe(true)
    expect(load).not.toHaveBeenCalled()
  })

  it('再点一次收起 ⇒ 清空终态记录', async () => {
    const { panel, uploads } = await setup(
      vi.fn().mockResolvedValue({ dir: DIR, filename: 'a.csv', size: 8 }),
    )
    await uploads.upload(DIR, [file('a.csv')], ['.csv'])
    panel.onToggleUpload()

    panel.onToggleUpload()

    expect(panel.uploadOpen.value).toBe(false)
    expect(uploads.items.value).toEqual([])
  })

  it('关闭入口与 `+` 收起同口径', async () => {
    const { panel, uploads } = await setup(
      vi.fn().mockResolvedValue({ dir: DIR, filename: 'a.csv', size: 8 }),
    )
    await uploads.upload(DIR, [file('a.csv')], ['.csv'])

    panel.onToggleUpload()
    panel.onCloseUpload()

    expect(panel.uploadOpen.value).toBe(false)
    expect(uploads.items.value).toEqual([])
  })
})

describe('useUploadPanel —— 选文件与重试转发', () => {
  it('pick：把目录级白名单透传给 upload（不在本层再判一次类型）', async () => {
    const { panel, uploads, upload } = await setup(
      vi.fn().mockResolvedValue({ dir: DIR, filename: 'a.csv', size: 8 }),
    )
    const spy = vi.spyOn(uploads, 'upload')

    panel.onPickFiles({ dir: DIR, files: [file('a.csv')] as unknown as FileList })

    expect(spy).toHaveBeenCalledWith(DIR, expect.any(Array), ['.csv', '.xlsx'])
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('retry：转给 uploads.retry，不新建记录', async () => {
    const { panel, uploads } = await setup(
      vi
        .fn()
        .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'x' })
        .mockResolvedValueOnce({ dir: DIR, filename: 'a.csv', size: 8 }),
    )
    await uploads.upload(DIR, [file('a.csv')], ['.csv'])
    const localId = uploads.items.value[0]!.localId

    panel.onRetryUpload(localId)
    await vi.waitFor(() => expect(uploads.items.value[0]!.status).toBe('success'))

    expect(uploads.items.value).toHaveLength(1)
    expect(uploads.items.value[0]!.localId).toBe(localId)
  })
})

describe('useUploadPanel —— 成功即回写 @（FR-001 / FR-003 / FR-004）', () => {
  it('成功 ⇒ 回写用落盘名调用一次，且回写时清单已登记（exists 已为真）', async () => {
    const { panel, workspace, acceptUpload } = await setup(
      vi.fn().mockResolvedValue({ dir: DIR, filename: '报告(1).csv', size: 8 }),
    )
    let existsAtAccept: boolean | null = null
    acceptUpload.mockImplementation((reference: FileReference) => {
      existsAtAccept = workspace.exists(reference)
      return true
    })

    panel.onPickFiles({ dir: DIR, files: [file('报告.csv')] as unknown as FileList })
    await vi.waitFor(() => expect(acceptUpload).toHaveBeenCalledTimes(1))

    expect(acceptUpload).toHaveBeenCalledWith({ dir: DIR, filename: '报告(1).csv' })
    expect(existsAtAccept).toBe(true)
    expect(workspace.exists({ dir: DIR, filename: '报告(1).csv' })).toBe(true)
  })

  it('失败 ⇒ acceptUpload 零调用（不把不存在的文件写进输入区）', async () => {
    const { panel, acceptUpload } = await setup(
      vi.fn().mockRejectedValue({ code: 'FILE_SCHEMA_INVALID', message: 'x' }),
    )

    panel.onPickFiles({ dir: DIR, files: [file('bad.csv')] as unknown as FileList })
    await flush()

    expect(acceptUpload).not.toHaveBeenCalled()
  })

  it('重试成功也只回写一次（同一 localId 不重复插 @）', async () => {
    const { panel, acceptUpload, uploads } = await setup(
      vi
        .fn()
        .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'x' })
        .mockResolvedValueOnce({ dir: DIR, filename: 'a.csv', size: 8 }),
    )
    panel.onPickFiles({ dir: DIR, files: [file('a.csv')] as unknown as FileList })
    await vi.waitFor(() => expect(uploads.items.value[0]!.status).toBe('failed'))
    expect(acceptUpload).not.toHaveBeenCalled()

    panel.onRetryUpload(uploads.items.value[0]!.localId)
    await vi.waitFor(() => expect(acceptUpload).toHaveBeenCalledTimes(1))
    await flush()

    expect(acceptUpload).toHaveBeenCalledTimes(1)
  })

  it('批量 3 个 ⇒ 按**完成顺序**回写 3 次（FR-005）', async () => {
    const resolvers: Array<() => void> = []
    const uploadImpl = vi.fn().mockImplementation(
      (_dir: string, _file: File, filename: string) =>
        new Promise((resolve) => {
          resolvers.push(() => resolve({ dir: DIR, filename, size: 8 }))
        }),
    )
    const { panel, acceptUpload } = await setup(uploadImpl)

    panel.onPickFiles({
      dir: DIR,
      files: [file('a.csv'), file('b.csv'), file('c.csv')] as unknown as FileList,
    })
    await vi.waitFor(() => expect(resolvers).toHaveLength(3))

    resolvers[2]!()
    await vi.waitFor(() => expect(acceptUpload).toHaveBeenCalledTimes(1))
    resolvers[0]!()
    resolvers[1]!()
    await vi.waitFor(() => expect(acceptUpload).toHaveBeenCalledTimes(3))

    expect(acceptUpload.mock.calls.map(([reference]) => reference.filename)).toEqual([
      'c.csv',
      'a.csv',
      'b.csv',
    ])
  })

  it('面板关闭后才完成的上传仍回写（FR-013），但不重新打开面板', async () => {
    let finish!: () => void
    const { panel, acceptUpload, uploads } = await setup(
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = () => resolve({ dir: DIR, filename: 'slow.csv', size: 8 })
          }),
      ),
    )

    panel.onToggleUpload()
    panel.onPickFiles({ dir: DIR, files: [file('slow.csv')] as unknown as FileList })
    await vi.waitFor(() => expect(uploads.items.value[0]!.status).toBe('uploading'))

    panel.onToggleUpload()
    expect(uploads.items.value).toHaveLength(1)

    finish()
    await vi.waitFor(() => expect(acceptUpload).toHaveBeenCalledTimes(1))

    expect(panel.uploadOpen.value).toBe(false)
    expect(acceptUpload).toHaveBeenCalledWith({ dir: DIR, filename: 'slow.csv' })
  })
})

describe('useUploadPanel —— 回写复用唯一入口（FR-005 / FR-006 / FR-007）', () => {
  /** 用**真实**的 mention composer 当 `acceptUpload`：上限与"删标记同步"的口径只有一处实现 */
  function realAccept() {
    const draft = ref('帮我分析一下 ')
    const mention: FileMentionStore = {
      open: ref(false),
      caret: ref(0),
      spaces: computed(() => []),
      column: ref<MentionColumn>('space'),
      activeSpace: ref<string | null>(null),
      activeDir: ref<string | null>(null),
      activeIndex: ref(0),
      references: ref<FileReference[]>([]),
      dirs: computed(() => []),
      files: computed(() => []),
      maxReached: computed(() => false),
      handleInput: vi.fn(),
      pickSpace: vi.fn(),
      pickDir: vi.fn(),
      pickFile: vi.fn(() => true),
      move: vi.fn(),
      confirmActive: vi.fn(() => null),
      back: vi.fn(),
      close: vi.fn(),
      remove: vi.fn(),
      reset: vi.fn(),
      buildAttachments: vi.fn(() => []),
    }
    const composer = useMentionComposer({ mention, draft })
    return { draft, mention, acceptUpload: composer.onPickFile }
  }

  async function panelWith(acceptUpload: (reference: FileReference) => boolean, filename: string) {
    const uploads = createUploadsStore({
      files: {
        upload: vi.fn().mockResolvedValue({ dir: DIR, filename, size: 8 }),
      } as unknown as FilesApi,
      toast: { push: vi.fn() } as unknown as ToastStore,
    })
    const workspace = createWorkspaceStore({
      files: { workspace: vi.fn().mockResolvedValue(workspaceResponse()) } as unknown as FilesApi,
      toast: { push: vi.fn() } as unknown as ToastStore,
    })
    await workspace.load()
    return { uploads, panel: useUploadPanel({ uploads, workspace, acceptUpload }) }
  }

  it('达到引用上限（pickFile 返回 false）⇒ 上传仍成功、记录仍在，但文本不变（不插第 11 个 @）', async () => {
    const { draft, mention, acceptUpload } = realAccept()
    mention.pickFile = vi.fn(() => false)
    const { uploads, panel } = await panelWith(acceptUpload, '第11个.csv')

    panel.onPickFiles({ dir: DIR, files: [file('第11个.csv')] as unknown as FileList })
    await vi.waitFor(() => expect(uploads.items.value[0]!.status).toBe('success'))
    await flush()

    expect(draft.value).toBe('帮我分析一下 ')
    expect(uploads.items.value[0]!.status).toBe('success')
  })

  it('正常回写：追加在末尾、原有文本逐字不变；删掉标记后再收起不复活（FR-007）', async () => {
    const { draft, acceptUpload } = realAccept()
    const { panel } = await panelWith(acceptUpload, '报告(1).csv')

    panel.onPickFiles({ dir: DIR, files: [file('报告.csv')] as unknown as FileList })
    await vi.waitFor(() =>
      expect(draft.value).toBe(
        `帮我分析一下 ${mentionToken({ dir: DIR, filename: '报告(1).csv' })} `,
      ),
    )

    // 用户手动删掉标记 → 收起面板 → 标记不得被"恢复"
    draft.value = '帮我分析一下 '
    panel.onToggleUpload()
    panel.onCloseUpload()

    expect(draft.value).toBe('帮我分析一下 ')
  })
})

/**
 * 2026-11-17 v1.3：粘贴**不落盘**。
 *
 * 顺序是硬要求：
 * ① 白名单未加载先补 load（空名单会让格式校验失效）；
 * ② 逐文件取舍：合格的进胶囊、不合格的记原因（不再整批作废）；
 * ③ 名额有限：超出单条消息引用上限的同样跳过并说明；
 * ④ 胶囊名就地消解"本条消息内重名"，磁盘重名留到发送。
 */
describe('useUploadPanel —— 粘贴只入胶囊，不落盘（v1.3）', () => {
  it('全部合格 ⇒ 零请求、零上传记录，胶囊挂在临时空间', async () => {
    const upload = echoUpload()
    const { panel, uploads, acceptUpload, toast } = await setup(upload)

    await panel.onPasteFiles([file('a.csv'), file('b.png')])

    expect(upload).not.toHaveBeenCalled()
    expect(uploads.items.value).toEqual([])
    expect(panel.uploadOpen.value).toBe(false)
    expect(acceptUpload.mock.calls.map(([reference]) => reference)).toEqual([
      { dir: TMP, filename: 'a.csv' },
      { dir: TMP, filename: 'b.png' },
    ])
    expect(toast.push).not.toHaveBeenCalled()
  })

  it('部分不合格 ⇒ 合格的收下、不合格的跳过并由 toast 说明（不再整批作废）', async () => {
    const upload = echoUpload()
    const { panel, acceptUpload, toast } = await setup(upload)

    await panel.onPasteFiles([file('a.csv'), file('b.exe')])

    expect(upload).not.toHaveBeenCalled()
    expect(acceptUpload.mock.calls.map(([reference]) => reference.filename)).toEqual(['a.csv'])
    expect(toast.push).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('已附加 1 个文件，1 个未附加'),
    )
  })

  it('全部不合格 ⇒ 一个胶囊都不挂，toast 用 error 级', async () => {
    const { panel, acceptUpload, toast } = await setup(echoUpload())

    await panel.onPasteFiles([file('a.exe')])

    expect(acceptUpload).not.toHaveBeenCalled()
    expect(toast.push).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('1 个未附加'),
    )
  })

  it('名额不足 ⇒ 只收下装得下的，其余跳过并说明', async () => {
    const initialReferences: FileReference[] = Array.from({ length: 9 }, (_item, index) => ({
      dir: TMP,
      filename: `old-${index}.csv`,
    }))
    const { panel, acceptUpload, toast } = await setup(echoUpload(), { initialReferences })

    await panel.onPasteFiles([file('a.csv'), file('b.csv'), file('c.csv')])

    expect(acceptUpload.mock.calls.map(([reference]) => reference.filename)).toEqual(['a.csv'])
    expect(toast.push).toHaveBeenCalledWith('info', expect.stringContaining('2 个未附加'))
  })

  it('引用数已达上限 ⇒ 一个都不收，且零请求', async () => {
    const upload = echoUpload()
    const full: FileReference[] = Array.from({ length: 10 }, (_item, index) => ({
      dir: TMP,
      filename: `old-${index}.csv`,
    }))
    const { panel, acceptUpload, toast } = await setup(upload, { initialReferences: full })

    await panel.onPasteFiles([file('a.csv')])

    expect(upload).not.toHaveBeenCalled()
    expect(acceptUpload).not.toHaveBeenCalled()
    expect(toast.push).toHaveBeenCalledWith('error', expect.stringContaining('上限'))
  })

  it('同一批内部重名 ⇒ 第二个改成 a(1).csv（两个同名标记会互相牵连）', async () => {
    const { panel, acceptUpload } = await setup(echoUpload())

    await panel.onPasteFiles([file('a.csv'), file('a.csv')])

    expect(acceptUpload.mock.calls.map(([reference]) => reference.filename)).toEqual([
      'a.csv',
      'a(1).csv',
    ])
  })

  it('与本条消息已有胶囊重名 ⇒ 粘贴件让位成 a(1).csv（盘上重名仍不查）', async () => {
    const { panel, acceptUpload, upload } = await setup(echoUpload(), {
      initialReferences: [{ dir: DIR, filename: 'a.csv' }],
    })

    await panel.onPasteFiles([file('a.csv')])

    expect(acceptUpload).toHaveBeenCalledWith({ dir: TMP, filename: 'a(1).csv' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('草稿里看不见的引用不占名（会话残留的幽灵引用）', async () => {
    const { panel, acceptUpload } = await setup(echoUpload(), {
      initialReferences: [{ dir: TMP, filename: 'a.csv' }],
      draft: '帮我看看这个 ',
    })

    await panel.onPasteFiles([file('a.csv')])

    expect(acceptUpload).toHaveBeenCalledWith({ dir: TMP, filename: 'a.csv' })
  })

  it('工作空间未加载 ⇒ 先 load 再校验（不能拿空白名单放行）', async () => {
    const upload = echoUpload()
    const uploads = createUploadsStore({
      files: { upload } as unknown as FilesApi,
      toast: { push: vi.fn() } as unknown as ToastStore,
    })
    const loadSpy = vi.fn().mockResolvedValue(workspaceResponse())
    const workspace = createWorkspaceStore({
      files: { workspace: loadSpy } as unknown as FilesApi,
      toast: { push: vi.fn() } as unknown as ToastStore,
    })
    const toast = { push: vi.fn() } as unknown as ToastStore
    const acceptUpload = vi.fn(() => true)
    const panel = useUploadPanel({ uploads, workspace, acceptUpload, toast })

    await panel.onPasteFiles([file('a.csv')])

    expect(loadSpy).toHaveBeenCalledTimes(1)
    expect(acceptUpload).toHaveBeenCalledTimes(1)
    expect(upload).not.toHaveBeenCalled()
  })

  it('临时空间缺失（空间未就绪）⇒ 提示且不挂胶囊', async () => {
    const uploads = createUploadsStore({
      files: { upload: vi.fn() } as unknown as FilesApi,
      toast: { push: vi.fn() } as unknown as ToastStore,
    })
    const workspace = createWorkspaceStore({
      // 只返回数据准备：没有临时空间
      files: {
        workspace: vi.fn().mockResolvedValue({
          scenario: '生产计划',
          spaces: workspaceResponse().spaces.slice(0, 1),
        }),
      } as unknown as FilesApi,
      toast: { push: vi.fn() } as unknown as ToastStore,
    })
    await workspace.load()
    const toast = { push: vi.fn() } as unknown as ToastStore
    const acceptUpload = vi.fn(() => true)
    const panel = useUploadPanel({ uploads, workspace, acceptUpload, toast })

    await panel.onPasteFiles([file('a.csv')])

    expect(acceptUpload).not.toHaveBeenCalled()
    expect(toast.push).toHaveBeenCalledWith('error', expect.stringContaining('尚未就绪'))
  })
})

/**
 * 2026-11-17 v1.3：发送那一刻才落盘。
 *
 * 三条不变式：
 * 1. 名字按"临时空间现存 + 本条消息已有胶囊 + 本批内部"预演，**服务端返回名才是权威**；
 * 2. 有文件没传上去 ⇒ 返回 `null`（调用方中止发送），已落盘的记住真名、重试不重复写；
 * 3. 删胶囊 / 换作用域只清内存（磁盘上从来没有这些文件，因此零请求、零提示）。
 */
describe('useUploadPanel.flushPending —— 发送时落盘（v1.3）', () => {
  it('没有待发件 ⇒ 原样返回，零请求', async () => {
    const upload = echoUpload()
    const { panel } = await setup(upload, {
      initialReferences: [{ dir: DIR, filename: 'a.csv' }],
    })

    const result = await panel.flushPending([{ dir: DIR, filename: 'a.csv' }])

    expect(result).toEqual([{ dir: DIR, filename: 'a.csv' }])
    expect(upload).not.toHaveBeenCalled()
  })

  it('待发件 ⇒ 传到临时空间，且附件换成服务端返回名', async () => {
    const upload = echoUpload()
    const { panel, references, workspace } = await setup(upload)

    await panel.onPasteFiles([file('a.csv')])
    const result = await panel.flushPending(references.value)

    expect(upload).toHaveBeenCalledWith(TMP, expect.any(File), 'a.csv')
    expect(result).toEqual([{ dir: TMP, filename: 'a.csv' }])
    // 落盘后立刻登记清单：后续 `exists` 与临时空间列表都要能看见
    expect(workspace.exists({ dir: TMP, filename: 'a.csv' })).toBe(true)
  })

  it('与临时空间现存文件重名 ⇒ 自动加 (1)（发送前现取清单）', async () => {
    const upload = echoUpload()
    const { panel, references } = await setup(upload, { existing: ['a.csv', 'a(1).csv'] })

    await panel.onPasteFiles([file('a.csv')])
    const result = await panel.flushPending(references.value)

    expect(upload).toHaveBeenCalledWith(TMP, expect.any(File), 'a(2).csv')
    expect(result).toEqual([{ dir: TMP, filename: 'a(2).csv' }])
  })

  it('本条消息里已引用的同名真实文件也占名（两个 @a.csv 分不清）', async () => {
    const upload = echoUpload()
    const real: FileReference = { dir: DIR, filename: 'a.csv' }
    const { panel, references } = await setup(upload, { initialReferences: [real] })

    await panel.onPasteFiles([file('a.csv')])
    const result = await panel.flushPending(references.value)

    expect(result).toEqual([
      { dir: DIR, filename: 'a.csv' },
      { dir: TMP, filename: 'a(1).csv' },
    ])
  })

  it('服务端再套一层序号时，界面用服务端的真名（前端只是预演）', async () => {
    // 模拟竞态：前端预演 a.csv，但落盘瞬间名字被占，后端改成 a(1).csv
    const upload = vi.fn().mockResolvedValue({ dir: TMP, filename: 'a(1).csv', size: 8 })
    const { panel, references } = await setup(upload)

    await panel.onPasteFiles([file('a.csv')])
    const result = await panel.flushPending(references.value)

    expect(result).toEqual([{ dir: TMP, filename: 'a(1).csv' }])
  })

  it('有文件传失败 ⇒ 返回 null 并提示，不发消息的那一侧由调用方负责', async () => {
    const upload = vi
      .fn()
      .mockImplementation((_dir: string, _file: File, filename: string) =>
        filename === 'b.csv'
          ? Promise.reject({ code: 'NETWORK_ERROR', message: 'x' })
          : Promise.resolve({ dir: TMP, filename, size: 8 }),
      )
    const { panel, references, toast } = await setup(upload)

    await panel.onPasteFiles([file('a.csv'), file('b.csv')])
    const result = await panel.flushPending(references.value)

    expect(result).toBeNull()
    expect(toast.push).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('1 个文件上传失败，消息未发送'),
    )
  })

  it('重试：已落盘的文件复用真名，不会在临时空间留下第二份', async () => {
    let failB = true
    const upload = vi
      .fn()
      .mockImplementation((_dir: string, _file: File, filename: string) =>
        filename === 'b.csv' && failB
          ? Promise.reject({ code: 'NETWORK_ERROR', message: 'x' })
          : Promise.resolve({ dir: TMP, filename, size: 8 }),
      )
    const { panel, references } = await setup(upload)

    await panel.onPasteFiles([file('a.csv'), file('b.csv')])
    expect(await panel.flushPending(references.value)).toBeNull()

    failB = false
    upload.mockClear()
    const result = await panel.flushPending(references.value)

    expect(upload.mock.calls.map(([, , filename]) => filename)).toEqual(['b.csv'])
    expect(result).toEqual([
      { dir: TMP, filename: 'a.csv' },
      { dir: TMP, filename: 'b.csv' },
    ])
  })

  it('删除胶囊后不再上传（内存已丢，磁盘本来就没有）', async () => {
    const upload = echoUpload()
    const { panel, references } = await setup(upload)

    await panel.onPasteFiles([file('a.csv')])
    const stale = [...references.value]
    references.value = []
    await flush()

    const result = await panel.flushPending(stale)

    expect(upload).not.toHaveBeenCalled()
    expect(result).toEqual(stale)
  })

  it('换数字人 ⇒ 丢弃待发件且不删任何东西', async () => {
    const upload = echoUpload()
    const { panel, references, uploads, agent } = await setup(upload, { thread: 'th-1' })

    await panel.onPasteFiles([file('a.csv')])
    const stale = [...references.value]
    agent.value = '另一个数字人'
    await flush()

    expect(await panel.flushPending(stale)).toEqual(stale)
    expect(upload).not.toHaveBeenCalled()
    expect(uploads.items.value).toEqual([])
  })

  it('切到别的会话再回来 ⇒ 待发件还在（按会话分桶，互不串台）', async () => {
    const upload = echoUpload()
    const { panel, references, thread } = await setup(upload, { thread: 'th-1' })

    await panel.onPasteFiles([file('a.csv')])
    const stale = [...references.value]

    thread.value = 'th-2'
    await flush()
    expect(await panel.flushPending(stale)).toEqual(stale)
    expect(upload).not.toHaveBeenCalled()

    thread.value = 'th-1'
    await flush()
    expect(await panel.flushPending(stale)).toEqual([{ dir: TMP, filename: 'a.csv' }])
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('自动建会话（null → 真 id）⇒ 待发件被接管，仍能落盘', async () => {
    const upload = echoUpload()
    const { panel, references, thread } = await setup(upload)

    await panel.onPasteFiles([file('a.csv')])
    const stale = [...references.value]

    thread.value = 'th-new'
    await flush()

    expect(await panel.flushPending(stale)).toEqual([{ dir: TMP, filename: 'a.csv' }])
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('isPending 只认"临时空间 + 待发表"', async () => {
    const { panel } = await setup(echoUpload())

    await panel.onPasteFiles([file('a.csv')])

    expect(panel.isPending({ dir: TMP, filename: 'a.csv' })).toBe(true)
    expect(panel.isPending({ dir: DIR, filename: 'a.csv' })).toBe(false)
  })

  it('commitPending：只摘本轮真的发出去的项，未发送的胶囊原样留着', async () => {
    const upload = echoUpload()
    const { panel, references } = await setup(upload)

    await panel.onPasteFiles([file('a.csv'), file('b.csv')])
    const sent = await panel.flushPending([references.value[0]!])
    expect(sent).toEqual([{ dir: TMP, filename: 'a.csv' }])

    panel.commitPending(sent ?? [])

    expect(panel.isPending({ dir: TMP, filename: 'a.csv' })).toBe(false)
    expect(panel.isPending({ dir: TMP, filename: 'b.csv' })).toBe(true)
  })
})
