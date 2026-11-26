
import { ref, type Ref } from 'vue'

import type { FilesApi } from '../api/files'
import type { ErrorInfo } from '../api/types'
import { isUploadAllowed } from '../utils/file-kind'
import { toErrorInfo } from '../utils/error-message'
import { useSession } from './useAppSession'
import type { ToastStore } from './useToast'

export type UploadStatus = 'pending' | 'uploading' | 'success' | 'failed'

export interface UploadedDocument {
  localId: string
  dir: string
  name: string
  size: number
  status: UploadStatus
  serverFilename: string | null
  error: ErrorInfo | null
}

export interface UploadsDeps {
  files: FilesApi
  toast?: ToastStore
}

export interface NamedUpload {
  file: File
  name: string
}

export interface NamedUploadResult {
  name: string
  ok: boolean
  serverFilename: string | null
  error: ErrorInfo | null
}

export interface UploadOptions {
  toastOnFailure?: boolean
}

export interface UploadsStore {
  items: Readonly<Ref<UploadedDocument[]>>
  upload(
    dir: string,
    files: File[],
    allowedExtensions?: readonly string[],
    options?: UploadOptions,
  ): Promise<void>
  uploadNamed(dir: string, entries: readonly NamedUpload[]): Promise<NamedUploadResult[]>
  retry(localId: string): Promise<void>
  clear(): void
}

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
    options: UploadOptions = {},
  ): Promise<void> {
    const tasks: Promise<void>[] = []

    for (const file of files) {
      const entry = createEntry(dir, file)
      sources.set(entry.localId, { file, dir, exts: allowedExtensions })

      const check = isUploadAllowed({ name: file.name, size: file.size }, allowedExtensions)
      if (!check.ok) {
        entry.status = 'failed'
        entry.error = { code: check.code ?? 'VALIDATION_FAILED', message: '' }
        items.value = [...items.value, entry]
        continue
      }

      items.value = [...items.value, entry]
      tasks.push(startUpload(entry.localId))
    }

    await Promise.all(tasks)

    const failed = items.value.filter((item) => item.status === 'failed').length
    if (failed > 0 && options.toastOnFailure !== false) {
      deps.toast?.push('error', `${failed} 个文件上传失败，可重试`)
    }
  }

  /**
   * **带名**逐文件上传（2026-11-17 v1.3）：**不建记录、不弹提示**，只回传每个文件的结果。
   *
   * 为什么绕开 `items`：粘贴的落盘发生在发送那一刻，面板根本没开；若往 `items` 里塞，
   * 用户下次展开面板会看到一批"自己没点过"的成功记录。失败由调用方一条 toast 说清
   * （整条消息中止，草稿与胶囊原样保留）。
   */
  async function uploadNamed(
    dir: string,
    entries: readonly NamedUpload[],
  ): Promise<NamedUploadResult[]> {
    // 后端一次只接受一个文件：拆成 N 个请求并发，结果按入参顺序回填
    return Promise.all(
      entries.map(async ({ file, name }): Promise<NamedUploadResult> => {
        try {
          const response = await deps.files.upload(dir, file, name)
          return { name, ok: true, serverFilename: response.filename, error: null }
        } catch (cause) {
          return { name, ok: false, serverFilename: null, error: toErrorInfo(cause) }
        }
      }),
    )
  }

  async function retry(localId: string): Promise<void> {
    if (!sources.has(localId)) {
      return
    }
    await startUpload(localId)
  }

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

  return { items, upload, uploadNamed, retry, clear }
}

export function useUploads(): UploadsStore {
  return useSession().uploads
}
