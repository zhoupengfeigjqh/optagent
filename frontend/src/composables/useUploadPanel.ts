/**
 * 上传面板接线（012）+ 粘贴待发（2026-11-17 v1.3）
 *
 * 为什么单独成文件：
 * 1. `useChatPanel.ts` 已逼近 500 行硬门禁（宪章原则二），内联回写逻辑必超；
 * 2. 面板接线本身是独立职责（开关 + 清空 + 回写），单独成文件才能被同名测试直接钉住。
 *
 * 两条关键约定（`+` 上传路径）：
 * - **回写复用唯一入口**：`acceptUpload` 由调用方传 `mentionComposer.onPickFile`，
 *   因此拼写（`mentionToken`）、上限（10）、去重与提示都只有一处实现（原则二）；
 * - **先登记清单、后写标记**：`workspace.registerFile` 让发送前的 `exists` 立刻为真，
 *   否则用户会"看到 `@` 却发不出去"（012 FR-004）。
 *
 * 粘贴（v1.3）与 `+` 上传是两条不同的路径：
 * - **粘贴不落盘**：只校验格式（扩展名 / 5MB / 引用上限），合格的立刻进胶囊，文件留在内存；
 *   不合格的跳过并由一条 toast 说明（不再整批作废——既然没有半成品落盘，就没有原子性理由）。
 * - **发送那一刻才落盘**：`flushPending` 把待发件传到临时空间，名字按"临时空间现存文件 +
 *   本条消息已有胶囊 + 本批内部"预演（`utils/upload-name.ts`），服务端返回名才是权威。
 * - 失败即整条中止：草稿、胶囊、内存文件全留，用户再点发送就整批重试。
 * - 换作用域（数字人 / 会话）或删掉胶囊 ⇒ 待发件**直接丢弃**，磁盘上本来就什么都没有。
 *
 * 已废弃（v1.2）：粘贴即落盘 + 30 秒冷却回收 + 重名确认弹窗。落盘时机挪到发送后，
 * 前两者失去存在理由；重名改为自动加序号，不再打断用户。
 */
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

/** 构造参数。 */
export interface UploadPanelDeps {
  uploads: UploadsStore
  workspace: WorkspaceStore
  /** 复用 `mentionComposer.onPickFile`：登记引用 + 写 `@标记` + 上限/去重/提示；返回是否真的收下 */
  acceptUpload: (reference: FileReference) => boolean
  /** 提示出口（粘贴的格式拒绝、空间未就绪、发送时上传失败） */
  toast?: ToastStore
  /** 当前已引用文件数（判上限用；缺省按 0 处理） */
  referenceCount?: () => number
  /** 取目标目录的**最新**文件名清单（发送时算重名用）；缺省/失败时回退 workspace 缓存 */
  listFiles?: (dir: string) => Promise<Array<{ filename: string }>>
  /**
   * 当前**引用集合**：唯一用途是"用户把胶囊删了 ⇒ 内存里那份文件也没用了"。
   * 只丢内存，**不发任何请求**（磁盘上从来没有这些文件）。
   */
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
  /**
   * 当前草稿文本（可选）：只认"草稿里真实可见"的引用。
   *
   * 胶囊靠 `@文件名` 文本渲染，因此文本里没有它的引用必然是看不见的幽灵引用，
   * 不该占名字、也不该计名额。
   */
  draft?: () => string
}

/** 上传面板契约（`useChatPanel` 原样导出这几个名字，视图不受影响）。 */
export interface UploadPanel {
  uploadOpen: Readonly<Ref<boolean>>
  onToggleUpload(): void
  onCloseUpload(): void
  onPickFiles(payload: { dir: string; files: FileList }): void
  /** 粘贴：只校验、只入胶囊，**不落盘**；合格的收下、不合格的 toast 说明后跳过 */
  onPasteFiles(files: File[]): Promise<void>
  /**
   * 发送前把待发件上传到临时空间（重名自动加序号）。
   *
   * @returns 最终附件清单（粘贴项的 `filename` 换成服务端真名）；`null` = 有文件没传上去，
   *   调用方 MUST 中止发送并保留草稿/胶囊/内存文件。
   */
  flushPending(attachments: readonly FileReference[]): Promise<FileReference[] | null>
  /** 该引用是否属于"粘贴待发"（发送前存在性校验要豁免它：文件还不存在，马上就要落盘） */
  isPending(reference: FileReference): boolean
  /** 发送成功后摘掉已落盘的待发项（失败不摘，重试时实测到 `uploadedAs` 即可复用） */
  commitPending(attachments: readonly FileReference[]): void
  onRetryUpload(localId: string): void
}

/** 粘贴待发项：文件只在内存（`File`），磁盘上**还没有**它。 */
interface PendingFile {
  file: File
  /**
   * 已经落盘的名字。非 `null` 只可能出现在"部分文件上传失败 ⇒ 整条中止"之后：
   * 重试时必须复用这个名字，否则会在临时空间里留下两份同样的文件。
   */
  uploadedAs: string | null
}

/** 待发表的键：显示名（小写）。胶囊文本就是它，天然一文件一键。 */
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

  /** 会话键：数字人 + 会话 id（`null` 也占一个桶 = "还没建会话的新对话"） */
  function sessionKey(): string {
    return `${deps.agent?.() ?? ''}\u0000${deps.thread?.() ?? ''}`
  }

  /** 当前会话的待发表（`create` = 没有就建；flush/查询一律不建） */
  function pendingTable(create: boolean): Map<string, PendingFile> | null {
    const key = sessionKey()
    const existing = pendingBySession.get(key)
    if (existing !== undefined) return existing
    if (!create) return null
    const table = new Map<string, PendingFile>()
    pendingBySession.set(key, table)
    return table
  }

  /** 收起：清空终态记录（进行中的保留），不动文件、`@` 与引用（FR-010 / FR-011 / FR-013） */
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
    // 目录树取自 workspace 接口：展开时若还没有目录就补一次加载，
    // 否则"进页面直接点加号"时目录为空，只会看到兜底文案
    if (deps.workspace.spaces.value.length === 0 && !deps.workspace.loading.value) {
      void deps.workspace.load()
    }
  }

  function onCloseUpload(): void {
    collapse()
  }

  function onPickFiles(payload: { dir: string; files: FileList }): void {
    // 扩展名白名单按目标空间下发（workspace 接口），数据准备仅 csv/xlsx
    void deps.uploads.upload(
      payload.dir,
      Array.from(payload.files),
      deps.workspace.uploadExtensionsOf(payload.dir),
    )
  }

  /** 不合格原因文案（与 `toUserMessage(..., 'upload')` 的码一一对应） */
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

  /** 草稿里**看得见**的引用（胶囊靠文本渲染：文本里没有它，就等于用户看不见） */
  function visibleReferences(): readonly FileReference[] {
    const references = deps.references?.() ?? []
    if (deps.draft === undefined) return references
    const text = deps.draft()
    return references.filter((reference) => text.includes(mentionToken(reference)))
  }

  /**
   * 粘贴（2026-11-17 v1.3）：**只校验、只入胶囊，一个字节都不落盘**。
   *
   * 顺序是硬要求：
   * ① 先确保白名单已加载（空名单会让扩展名校验失效 = 绕过格式检查）；
   * ② 逐文件取舍（合格的收下、不合格的记原因）；
   * ③ 名额有限：超出单条消息引用上限的也一并跳过并说明；
   * ④ 胶囊名就地消解"与本条消息已有胶囊重名"（两个同名标记会让删除互相牵连），
   *    磁盘重名不查——那时才有目录清单，留到发送那一刻算。
   */
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

    // 已占用的**显示名**：只算草稿里看得见的引用（`+` 上传与面板选中的）——幽灵引用不占名，
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
      // 同一批内部重名也在这里消解：两个 `@a.csv` 标记会让"删一个"变成"删两个"
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

  /** 目标目录**最新**文件名（发送时算重名用）：优先现取，失败回退 workspace 缓存 */
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

    /** 已落盘过的（上次中途失败）：名字直接占住，不重复请求 */
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
      // 基名用**原始文件名**，不是胶囊里的占位名：消息内冲突时占位名可能已带 `(1)`，
      // 拿它当基名会叠出 `a(1)(1).csv`（023 v1.4）
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

    // 键 = 胶囊里的显示名；值 = 真正落盘的名字
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
    // 搜所有会话桶：发送过程中会话 id 可能刚从 `null` 变成真 id（自动建会话）
    for (const table of pendingBySession.values()) {
      for (const [key, entry] of table) {
        // 只摘"这一轮确实发出去的"：卡片发送不带输入区附件时，胶囊要原样留着
        if (entry.uploadedAs !== null && landed.has(pendingKey(entry.uploadedAs))) {
          table.delete(key)
        }
      }
    }
  }

  // 用户删掉胶囊（点 `x` 或退格删标记，两者最终都表现为引用消失）⇒ 内存里那份文件也没用了。
  // 只动**当前会话**的表：别的会话的待发件与这里的引用无关。
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

  // 自动建会话（`null → 真 id`）不是"换会话"：这批待发件属于正在发送的这条消息，跟着搬过去
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
        // 点「新建对话」：视图态新对话不建桶（与草稿同口径），残留一律作废
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
