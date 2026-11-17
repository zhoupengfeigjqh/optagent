/**
 * 文档上传（FR-010、FR-011、V-13）
 *
 * 两条硬约束：
 * 1. **客户端预校验**：扩展名 ∉ 5 种白名单 或 单文件 > 5MB → 直接置 `failed` 并给出原因，**不发请求**。
 * 2. **逐文件各发一次请求**：后端上传接口一次只接受一个文件（多 `file` part 仅最后一个生效），
 *    因此多选时必须拆成 N 次请求，各自独立状态与重试，单文件失败不影响其他项。
 *
 * 落盘名一律取响应中的 `filename`（后端按"不重名用原名 / 重名 `原名(n).ext`"落盘，
 * 见 `agent-backend/src/domain/upload-name.ts`）。唯一例外是粘贴待发批次（`uploadNamed`）：
 * 它把前端**预演**的名字当请求名传过去，但界面仍取服务端返回名（`utils/upload-name.ts`）。
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

/** 一次"带名上传"的入参（粘贴待发批次，2026-11-17 v1.3） */
export interface NamedUpload {
  file: File
  /** 请求时使用的文件名（前端**预演**命名；服务端仍可能再加序号） */
  name: string
}

/** 一次"带名上传"的结果（与入参同序） */
export interface NamedUploadResult {
  /** 请求时使用的文件名 */
  name: string
  ok: boolean
  /** 服务端落盘名（唯一权威；附件与气泡都取它） */
  serverFilename: string | null
  error: ErrorInfo | null
}

/** 逐文件上传的可选行为 */
export interface UploadOptions {
  /** 失败时是否由本 store 弹汇总提示（默认 true；粘贴入口自己给带「重试」的提示时置 false） */
  toastOnFailure?: boolean
}

/** 上传 composable 契约。 */
export interface UploadsStore {
  items: Readonly<Ref<UploadedDocument[]>>
  /** 逐文件上传（FR-010）；`allowedExtensions` 为目标空间白名单（workspace 接口下发） */
  upload(
    dir: string,
    files: File[],
    allowedExtensions?: readonly string[],
    options?: UploadOptions,
  ): Promise<void>
  /**
   * **带名**逐文件上传（2026-11-17 v1.3，粘贴待发批次的唯一落盘入口）。
   *
   * 与 `upload()` 的两点不同，都是为了"粘贴不落盘"：
   * 1. **不建上传记录**：粘贴入口从来不开面板，建了行也只会在下次展开时冒出来；
   * 2. **名字由调用方给**：前端预演命名，服务端仍可能再改（撞名），故返回每个文件的
   *    服务端真名供调用方回写。
   */
  uploadNamed(dir: string, entries: readonly NamedUpload[]): Promise<NamedUploadResult[]>
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
    options: UploadOptions = {},
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

  return { items, upload, uploadNamed, retry, clear }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useUploads(): UploadsStore {
  return useSession().uploads
}
