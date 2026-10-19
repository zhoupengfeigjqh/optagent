/**
 * 单元测试：上传面板接线（`useUploadPanel`，012 新建）
 *
 * 钉住三条接线（对应 012 FR-001 / FR-003 / FR-004 / FR-005 / FR-006 / FR-007 / FR-010 / FR-013）：
 * 1. **成功即回写**：每个成功项调用 `acceptUpload({dir, filename})` 恰好一次，且**先**登记清单
 *    （`workspace.exists` 立刻为真），失败项零调用；
 * 2. **收起即清空终态**：`+` 收起与关闭入口都调 `uploads.clear()`，但不动文件与引用；
 * 3. **回写复用唯一入口**：`acceptUpload` 就是 `mentionComposer.onPickFile`，因此引用上限、
 *    去重与"删标记后同步移除"这些口径**不需要**在本模块重写（这里只验证转发与顺序）。
 */
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
          },
        ],
      },
    ],
  }
}

function file(name: string): File {
  return new File([new Uint8Array(8)], name, { type: 'text/csv' })
}

async function setup(uploadImpl: ReturnType<typeof vi.fn> = vi.fn()) {
  const uploads = createUploadsStore({
    files: { upload: uploadImpl } as unknown as FilesApi,
    toast: { push: vi.fn() } as unknown as ToastStore,
  })
  const workspace = createWorkspaceStore({
    files: { workspace: vi.fn().mockResolvedValue(workspaceResponse()) } as unknown as FilesApi,
    toast: { push: vi.fn() } as unknown as ToastStore,
  })
  await workspace.load()

  const acceptUpload = vi.fn()
  const panel = useUploadPanel({ uploads, workspace, acceptUpload })

  return { uploads, workspace, acceptUpload, panel, upload: uploadImpl }
}

/** 让挂起的异步（watch / 上传）走完一轮 */
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
    panel.onToggleUpload() // 展开

    panel.onToggleUpload() // 收起

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
    /** 回写那一刻的存在性快照：为 true 即证明 `registerFile` 先于 `acceptUpload` */
    let existsAtAccept: boolean | null = null
    acceptUpload.mockImplementation((reference: FileReference) => {
      existsAtAccept = workspace.exists(reference)
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
    const uploadImpl = vi
      .fn()
      .mockImplementation(
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

    // 逆序完成 ⇒ 回写顺序也跟着完成顺序，而不是选择顺序
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

    panel.onToggleUpload() // 收起：终态被清，但这条是 uploading ⇒ 保留
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
      missingReferences: vi.fn(() => []),
    }
    const composer = useMentionComposer({ mention, draft })
    return { draft, mention, acceptUpload: composer.onPickFile }
  }

  async function panelWith(acceptUpload: (reference: FileReference) => void, filename: string) {
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
