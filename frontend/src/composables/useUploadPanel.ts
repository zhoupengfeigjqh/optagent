import { ref, watch, type Ref } from 'vue'

import type { FileReference } from '../api/types'
import { MAX_REFERENCES_PER_MESSAGE } from '../constants/limits'
import { TMP_SPACE } from '../constants/spaces'
import { toUserMessage } from '../utils/error-message'
import { partitionBatch } from '../utils/upload-batch'
import { allocateName } from '../utils/upload-name'
import { mentionToken } from './useFileMention'
import type { ToastStore } from './useToast'
import type { UploadsStore } from './useUploads'
import type { WorkspaceStore } from './useWorkspace'

export interface UploadPanelDeps {
  uploads: UploadsStore
  workspace: WorkspaceStore
  /** 复用 `mentionComposer.onPickFile`：登记引用 + 写 `@标记` + 上限/去重/提示；返回是否真的收下 */
  acceptUpload: (reference: FileReference) => boolean
  toast?: ToastStore
  /** 当前已引用文件数（判上限用；缺省按 0 处理） */
  referenceCount?: () => number
  listFiles?: (dir: string) => Promise<Array<{ filename: string }>>
  references?: () => readonly FileReference[]
  /**
   * 当前数字人：变化即清空**全部**会话桶（文件属于某个数字人的临时空间，换人后一律作废）。
   */
  agent?: () => string | null
  /**
   * 当前会话（`null` = 视图态新对话）。
   *
   * 2026-11-17（023 v1.4）：待发件**按会话分桶**。原先是一个全局表 + "作用域一变就清空"，
   * 于是自动建会话（首条消息 `null → 真 id`）被误判成"用户换了会话"，文件在落盘前被清掉，
   * 消息却照发——附件只剩一个名字，碰到临时空间同名文件就会**静默引用旧文件**。
   */
  thread?: () => string | null
  draft?: () => string
}

export interface UploadPanel {
  uploadOpen: Readonly<Ref<boolean>>
  onToggleUpload(): void
  onCloseUpload(): void
  onPickFiles(payload: { dir: string; files: FileList }): void
  onPasteFiles(files: File[]): Promise<void>
  /**
   * 发送前把待发件上传到临时空间（重名自动加序号）。
   *
   * @returns 最终附件清单（粘贴项的 `filename` 换成服务端真名）；`null` = 有文件没传上去，
   *   调用方 MUST 中止发送并保留草稿/胶囊/内存文件。
   */
  flushPending(attachments: readonly FileReference[]): Promise<FileReference[] | null>
  isPending(reference: FileReference): boolean
  commitPending(attachments: readonly FileReference[]): void
  onRetryUpload(localId: string): void
}

interface PendingFile {
  file: File
  /**
   * 已经落盘的名字。非 `null` 只可能出现在"部分文件上传失败 ⇒ 整条中止"之后：
   * 重试时必须复用这个名字，否则会在临时空间里留下两份同样的文件。
   */
  uploadedAs: string | null
}

function pendingKey(name: string): string {
  return name.toLowerCase()
}

export function useUploadPanel(deps: UploadPanelDeps): UploadPanel {
  const uploadOpen = ref(false)
  /**
   * 已回写过的项（按 `localId` 去重）。
   * 重试导致同一项二次成功时 MUST NOT 再插一个 `@`（012 不变式 I2）。
   */
  const echoed = new Set<string>()

  /**
   * 待发件按会话分桶：`会话键 → (显示名小写 → 待发项)`。
   *
   * 为什么必须分桶：两个会话可能各粘了一个同名文件，都要能各自发出去；共用一张全局表
   * 会互相覆盖（会话 1 的消息带上会话 2 的文件）。值只有内存文件，没有任何磁盘痕迹。
   */
  const pendingBySession = new Map<string, Map<string, PendingFile>>()

  function sessionKey(): string {
    return `${deps.agent?.() ?? ''}\u0000${deps.thread?.() ?? ''}`
  }

  function pendingTable(create: boolean): Map<string, PendingFile> | null {
    const key = sessionKey()
    const existing = pendingBySession.get(key)
    if (existing !== undefined) return existing
    if (!create) return null
    const table = new Map<string, PendingFile>()
    pendingBySession.set(key, table)
    return table
  }

  function collapse(): void {
    uploadOpen.value = false
    deps.uploads.clear()
  }

  function onToggleUpload(): void {
    if (uploadOpen.value) {
      collapse()
      return
    }
    uploadOpen.value = true
    // 否则"进页面直接点加号"时目录为空，只会看到兜底文案
    if (deps.workspace.spaces.value.length === 0 && !deps.workspace.loading.value) {
      void deps.workspace.load()
    }
  }

  function onCloseUpload(): void {
    collapse()
  }

  function onPickFiles(payload: { dir: string; files: FileList }): void {
    void deps.uploads.upload(
      payload.dir,
      Array.from(payload.files),
      deps.workspace.uploadExtensionsOf(payload.dir),
    )
  }

  function rejectionReason(code: 'FILE_TOO_LARGE' | 'VALIDATION_FAILED'): string {
    return toUserMessage({ code, message: '' }, 'upload')
  }

  /** 跳过项的汇总文案：最多列 3 个，避免 toast 过长 */
  function describeSkipped(items: ReadonlyArray<{ name: string; reason: string }>): string {
    const shown = items
      .slice(0, 3)
      .map((item) => `${item.name}（${item.reason}）`)
      .join('、')
    return items.length > 3 ? `${shown} 等 ${items.length} 个` : shown
  }

  function isPending(reference: FileReference): boolean {
    if (reference.dir !== TMP_SPACE) return false
    return pendingTable(false)?.has(pendingKey(reference.filename)) ?? false
  }

  function visibleReferences(): readonly FileReference[] {
    const references = deps.references?.() ?? []
    if (deps.draft === undefined) return references
    const text = deps.draft()
    return references.filter((reference) => text.includes(mentionToken(reference)))
  }

  async function onPasteFiles(files: File[]): Promise<void> {
    if (files.length === 0) return

    if (deps.workspace.spaces.value.length === 0) {
      await deps.workspace.load()
    }

    const space = deps.workspace.spaces.value.find((item) => item.name === TMP_SPACE)
    const allowed = deps.workspace.uploadExtensionsOf(TMP_SPACE)
    if (space === undefined || allowed.length === 0) {
      deps.toast?.push('error', '文件空间尚未就绪，未附加文件，请稍后重试')
      return
    }

    const { accepted, rejections } = partitionBatch(files, allowed)
    const skipped: Array<{ name: string; reason: string }> = rejections.map((item) => ({
      name: item.name,
      reason: rejectionReason(item.code),
    }))

    // 否则会话 1 里"看不见的旧引用"会让会话 2 的粘贴件平白多出一个 `(1)`
    const visible = visibleReferences()
    const taken = new Set<string>(visible.map((reference) => pendingKey(reference.filename)))
    const capacity = Math.max(
      0,
      MAX_REFERENCES_PER_MESSAGE -
        (deps.draft === undefined ? (deps.referenceCount?.() ?? 0) : visible.length),
    )
    let added = 0

    for (const file of accepted) {
      if (added >= capacity) {
        skipped.push({
          name: file.name,
          reason: `超出单条消息 ${MAX_REFERENCES_PER_MESSAGE} 个引用上限`,
        })
        continue
      }
      const filename = allocateName(file.name, taken)
      if (!deps.acceptUpload({ dir: TMP_SPACE, filename })) {
        skipped.push({ name: file.name, reason: '引用数已达上限' })
        continue
      }
      pendingTable(true)?.set(pendingKey(filename), { file, uploadedAs: null })
      added += 1
    }

    if (skipped.length > 0) {
      const summary = `${added > 0 ? `已附加 ${added} 个文件，` : ''}${skipped.length} 个未附加：`
      deps.toast?.push(added > 0 ? 'info' : 'error', `${summary}${describeSkipped(skipped)}`)
    }
  }

  async function existingNames(): Promise<string[]> {
    if (deps.listFiles) {
      try {
        const files = await deps.listFiles(TMP_SPACE)
        return files.map((file) => file.filename)
      } catch {
        // 取不到就用缓存：宁可少问一次，也不能因为一次 list 失败挡住发送
      }
    }
    return deps.workspace.filesOf(TMP_SPACE).map((file) => file.filename)
  }

  async function flushPending(
    attachments: readonly FileReference[],
  ): Promise<FileReference[] | null> {
    const pending = pendingTable(false)
    const targets = attachments.filter((reference) => isPending(reference))
    if (targets.length === 0) return [...attachments]

    if (deps.workspace.spaces.value.length === 0) {
      await deps.workspace.load()
    }
    if (!deps.workspace.spaces.value.some((item) => item.name === TMP_SPACE)) {
      deps.toast?.push('error', '文件空间尚未就绪，消息未发送，请稍后重试')
      return null
    }

    // 已占用的名字：临时空间现存的 + 本条消息里**不是待发**的引用（它们已占住自己的名字）
    const taken = new Set<string>()
    for (const name of await existingNames()) taken.add(pendingKey(name))
    for (const reference of attachments) {
      if (!isPending(reference)) taken.add(pendingKey(reference.filename))
    }

    const reused: Array<{ key: string; entry: PendingFile; name: string }> = []
    const fresh: Array<{ key: string; entry: PendingFile; name: string }> = []
    for (const reference of targets) {
      const key = pendingKey(reference.filename)
      const entry = pending?.get(key)
      if (entry === undefined) continue
      if (entry.uploadedAs !== null) {
        taken.add(pendingKey(entry.uploadedAs))
        reused.push({ key, entry, name: entry.uploadedAs })
        continue
      }
      fresh.push({ key, entry, name: allocateName(entry.file.name, taken) })
    }

    const results =
      fresh.length > 0
        ? await deps.uploads.uploadNamed(
            TMP_SPACE,
            fresh.map((item) => ({ file: item.entry.file, name: item.name })),
          )
        : []

    const failed: Array<{ name: string; reason: string }> = []
    fresh.forEach((item, index) => {
      const result = results[index]
      if (result === undefined || !result.ok || result.serverFilename === null) {
        failed.push({
          name: item.name,
          reason: toUserMessage(result?.error ?? { code: 'INTERNAL_ERROR', message: '' }, 'upload'),
        })
        return
      }
      item.entry.uploadedAs = result.serverFilename
      // 就地登记清单：后续 `exists` 与临时空间列表都要能看见它
      deps.workspace.registerFile({
        dir: TMP_SPACE,
        filename: result.serverFilename,
        size: item.entry.file.size,
      })
    })

    if (failed.length > 0) {
      deps.toast?.push(
        'error',
        `${failed.length} 个文件上传失败，消息未发送：${describeSkipped(failed)}`,
      )
      return null
    }

    const renamed = new Map<string, string>()
    for (const item of [...reused, ...fresh]) {
      if (item.entry.uploadedAs === null) continue
      renamed.set(item.key, item.entry.uploadedAs)
    }

    return attachments.map((reference) => {
      const filename = renamed.get(pendingKey(reference.filename))
      return filename === undefined ? reference : { dir: reference.dir, filename }
    })
  }

  function commitPending(attachments: readonly FileReference[]): void {
    const landed = new Set(attachments.map((reference) => pendingKey(reference.filename)))
    for (const table of pendingBySession.values()) {
      for (const [key, entry] of table) {
        if (entry.uploadedAs !== null && landed.has(pendingKey(entry.uploadedAs))) {
          table.delete(key)
        }
      }
    }
  }

  watch(
    () => deps.references?.(),
    (items) => {
      const table = pendingTable(false)
      if (table === null) return
      const alive = new Set(
        (items ?? [])
          .filter((reference) => reference.dir === TMP_SPACE)
          .map((reference) => pendingKey(reference.filename)),
      )
      for (const key of [...table.keys()]) {
        if (!alive.has(key)) table.delete(key)
      }
    },
  )

  watch(
    () => deps.thread?.() ?? null,
    (next, previous) => {
      const agent = deps.agent?.() ?? ''
      const from = `${agent}\u0000`
      if (previous === null && next !== null) {
        const moved = pendingBySession.get(from)
        if (moved !== undefined && moved.size > 0) {
          pendingBySession.set(`${agent}\u0000${next}`, moved)
        }
        pendingBySession.delete(from)
        return
      }
      if (next === null) {
        pendingBySession.delete(from)
      }
    },
  )

  // 换数字人：文件属于某个数字人的临时空间，待发件一律作废（从未落盘，丢掉零成本）
  watch(
    () => deps.agent?.() ?? null,
    () => {
      pendingBySession.clear()
    },
  )

  function onRetryUpload(localId: string): void {
    void deps.uploads.retry(localId)
  }

  // 成功即回写：`items` 一律不可变替换，故监听数组本身即可覆盖初次成功与重试成功
  watch(
    () => deps.uploads.items.value,
    (items) => {
      for (const item of items) {
        if (item.status !== 'success' || !item.serverFilename || echoed.has(item.localId)) {
          continue
        }
        echoed.add(item.localId)
        // 顺序不可颠倒：先让 exists 为真，再写 `@`（否则可能出现"标记在、引用不可发"）
        deps.workspace.registerFile({
          dir: item.dir,
          filename: item.serverFilename,
          size: item.size,
        })
        deps.acceptUpload({ dir: item.dir, filename: item.serverFilename })
      }
    },
  )

  return {
    uploadOpen,
    onToggleUpload,
    onCloseUpload,
    onPickFiles,
    onPasteFiles,
    flushPending,
    isPending,
    commitPending,
    onRetryUpload,
  }
}
