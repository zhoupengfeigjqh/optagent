/**
 * 文档上传（FR-010、FR-011、V-13）
 *
 * 两条硬约束：
 * 1. **客户端预校验**：扩展名 ∉ 5 种白名单 或 单文件 > 5MB → 直接置 `failed` 并给出原因，**不发请求**。
 * 2. **逐文件各发一次请求**：后端上传接口一次只接受一个文件（多 `file` part 仅最后一个生效），
 *    因此多选时必须拆成 N 次请求，各自独立状态与重试，单文件失败不影响其他项。
 *
 * 落盘名一律取响应中的 `filename`（后端按"不重名用原名 / 重名 `原名(n).ext`"落盘，
 * 见 `agent-backend/src/domain/upload-name.ts`），前端 MUST NOT 自行拼接后缀。
 */

import { ref, type Ref } from 'vue'

import type { FilesApi } from '../api/files'
import type { ErrorInfo } from '../api/types'
import { isUploadAllowed } from '../utils/file-kind'
import { toErrorInfo } from '../utils/error-message'
import { useSession } from './useAppSession'
import type { ToastStore } from './useToast'

/** 上传状态。 */
export type UploadStatus = 'pending' | 'uploading' | 'success' | 'failed'

/** 上传项（data-model §10）。 */
export interface UploadedDocument {
  /** 前端生成的唯一键（列表渲染用） */
  localId: string
  /** 目标目录（9 白名单之一） */
  dir: string
  /** 原始文件名 */
  name: string
  /** 字节数 */
  size: number
  status: UploadStatus
  /** 服务端落盘名（重名时带 `(n)` 后缀）；**展示名与 `@` 标记都取它** */
  serverFilename: string | null
  /** 失败原因（`ErrorInfo`，由 `toUserMessage(error, 'upload')` 映射文案） */
  error: ErrorInfo | null
}

/** 构造参数。 */
export interface UploadsDeps {
  files: FilesApi
  toast?: ToastStore
}

/** 上传 composable 契约。 */
export interface UploadsStore {
  items: Readonly<Ref<UploadedDocument[]>>
  /** 逐文件上传（FR-010）；`allowedExtensions` 为目标空间白名单（workspace 接口下发） */
  upload(dir: string, files: File[], allowedExtensions?: readonly string[]): Promise<void>
  /** 重试失败项（FR-011） */
  retry(localId: string): Promise<void>
  /**
   * 清空**终态**记录（成功 / 失败），保留 `pending` / `uploading`（012 FR-010 / FR-013）。
   *
   * 只清"记录"：不删已落盘文件、不移除输入区的 `@` 标记与引用、不取消进行中的请求。
   */
  clear(): void
}

/** 创建上传状态。 */
export function createUploadsStore(deps: UploadsDeps): UploadsStore {
  const items = ref<UploadedDocument[]>([])

  /** 重试所需的原始文件与目录（不进入响应式状态，避免持有 File 造成额外开销）。 */
  const sources = new Map<string, { file: File; dir: string; exts?: readonly string[] }>()
  let sequence = 0

  function update(localId: string, patch: Partial<UploadedDocument>): void {
    items.value = items.value.map((item) =>
      item.localId === localId ? { ...item, ...patch } : item,
    )
  }

  async function startUpload(localId: string): Promise<void> {
    const source = sources.get(localId)
    if (!source) {
      return
    }

    const check = isUploadAllowed({ name: source.file.name, size: source.file.size }, source.exts)
    if (!check.ok) {
      update(localId, {
        status: 'failed',
        error: { code: check.code ?? 'VALIDATION_FAILED', message: '' },
      })
      return
    }

    update(localId, { status: 'uploading', error: null })

    try {
      const response = await deps.files.upload(source.dir, source.file, source.file.name)
      update(localId, {
        status: 'success',
        serverFilename: response.filename,
        error: null,
      })
    } catch (cause) {
      update(localId, { status: 'failed', error: toErrorInfo(cause) })
    }
  }

  function createEntry(dir: string, file: File): UploadedDocument {
    sequence += 1
    return {
      localId: `upload-${sequence}`,
      dir,
      name: file.name,
      size: file.size,
      status: 'pending',
      serverFilename: null,
      error: null,
    }
  }

  async function upload(
    dir: string,
    files: File[],
    allowedExtensions?: readonly string[],
  ): Promise<void> {
    const tasks: Promise<void>[] = []

    for (const file of files) {
      const entry = createEntry(dir, file)
      sources.set(entry.localId, { file, dir, exts: allowedExtensions })

      const check = isUploadAllowed({ name: file.name, size: file.size }, allowedExtensions)
      if (!check.ok) {
        // 预校验失败：不发请求，直接给出原因
        entry.status = 'failed'
        entry.error = { code: check.code ?? 'VALIDATION_FAILED', message: '' }
        items.value = [...items.value, entry]
        continue
      }

      items.value = [...items.value, entry]
      tasks.push(startUpload(entry.localId))
    }

    // 各文件互不阻塞：单个失败不影响其余项
    await Promise.all(tasks)

    const failed = items.value.filter((item) => item.status === 'failed').length
    if (failed > 0) {
      deps.toast?.push('error', `${failed} 个文件上传失败，可重试`)
    }
  }

  async function retry(localId: string): Promise<void> {
    if (!sources.has(localId)) {
      return
    }
    await startUpload(localId)
  }

  /**
   * 收起面板即清空**终态**记录（012 FR-010 / FR-013，Q2 = B）。
   *
   * 关闭那一刻还在传的文件不参与清空：它继续传完、留到下次展开可见，成功仍照常回写 `@`。
   * 只清记录，不删文件、不动引用与输入区文本（FR-011）。
   */
  function clear(): void {
    const isTerminal = (item: UploadedDocument) =>
      item.status === 'success' || item.status === 'failed'
    for (const item of items.value) {
      if (isTerminal(item)) {
        sources.delete(item.localId)
      }
    }
    items.value = items.value.filter((item) => !isTerminal(item))
  }

  return { items, upload, retry, clear }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useUploads(): UploadsStore {
  return useSession().uploads
}
