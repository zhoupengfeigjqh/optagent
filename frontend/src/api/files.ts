/**
 * 文件接口（`contracts/backend-api.md` §5）
 *
 * 关键事实：
 * - §5.1 **上传接口一次只接受一个文件**（多个 `file` part 时仅最后一个生效）→ 多选须**逐文件各发一次请求**（§7 差异 5）
 * - §5.1 落盘名以响应中的 `filename` 为准（后端已追加时间戳并在重名时追加 `-1`/`-2`），前端 MUST NOT 自行拼接
 * - §5.3 下载**无大小上限** → 以 `<a download>` 直链触发，不经 `fetch`
 * - §5.4 预览**有大小上限**（默认 10MB）→ 文本类按需 `fetch`（便于展示错误态），`.pdf` 用 `<iframe>`
 * - §5.5 删除走 REST `DELETE /api/files`（`shared` 为共享只读目录，后端 403 `FILE_READONLY`）
 */

import { parseErrorResponse, type HttpClient } from './http'
import type { UploadResponse, WorkspaceFile, WorkspaceResponse } from './types'

/** 文件 API 接口。 */
export interface FilesApi {
  /** `POST /api/files/upload`（multipart：`file` 单文件 + `dir`） */
  upload(dir: string, file: File | Blob, filename?: string): Promise<UploadResponse>
  /** `GET /api/files/list?dir=` → 顶层数组 */
  list(dir: string): Promise<WorkspaceFile[]>
  /** `GET /api/files/download?dir=&filename=` 直链（无大小上限） */
  downloadUrl(dir: string, filename: string): string
  /** `GET /api/files/preview?dir=&filename=` 直链（供 `.pdf` 的 `<iframe>` 使用） */
  previewUrl(dir: string, filename: string): string
  /** `GET /api/files/preview` 文本内容（`.txt` / `.csv` / `.json`），失败时抛出结构化错误 */
  fetchPreviewText(dir: string, filename: string, signal?: AbortSignal): Promise<string>
  /**
   * 预检预览可用性（只探状态，不消费响应体）。
   *
   * 用途：`.pdf` 交给 `<iframe>` 直链后，前端**读不到它的响应体**——若文件超过预览上限，
   * iframe 只会渲染成浏览器错误页，用户既看不到"文件过大"也没有下载入口（FR-048）。
   * 因此在进入 iframe 前先探一次：非 2xx 时解析后端错误体并抛出结构化错误（含 `code`）。
   */
  probePreview(dir: string, filename: string, signal?: AbortSignal): Promise<void>
  /**
   * `DELETE /api/files?dir=&filename=` 删除文件。
   *
   * `shared` 为共享只读目录（后端 403 `FILE_READONLY`），其余 8 个目录可删。
   * 文件不存在（404 `FILE_NOT_FOUND`）与目录越权（403 `UPLOAD_DIR_FORBIDDEN`）均抛结构化错误。
   */
  remove(dir: string, filename: string): Promise<void>
  /** `GET /api/files/workspace` → 固定 9 个目录 */
  workspace(): Promise<WorkspaceResponse>
}

/** 创建文件 API。 */
export function createFilesApi(client: HttpClient): FilesApi {
  const previewUrl = (dir: string, filename: string): string =>
    client.url('/api/files/preview', { dir, filename })

  return {
    upload: (dir, file, filename) => {
      const form = new FormData()
      // 顺序契约：dir MUST 先于 file——后端解析到 dir 时即做目录校验（未选数字人 409、
      // 清单外 403），非法目录在文件开始上传前就被拒绝，省带宽（file 先到的旧顺序
      // 后端仍兼容，退回「先收后验」，结果一致仅时机不同）
      form.append('dir', dir)
      // 后端按 part 名 `file` 读取；第三个参数保证原始文件名正确传递
      form.append('file', file, filename ?? (file instanceof File ? file.name : 'blob'))
      return client.request<UploadResponse>('/api/files/upload', { method: 'POST', body: form })
    },

    list: (dir) => client.get<WorkspaceFile[]>('/api/files/list', { dir }),

    downloadUrl: (dir, filename) => client.url('/api/files/download', { dir, filename }),

    previewUrl,

    fetchPreviewText: async (dir, filename, signal) => {
      const response = await client.fetchImpl(previewUrl(dir, filename), { signal })
      if (!response.ok) {
        throw await parseErrorResponse(response)
      }
      return response.text()
    },

    probePreview: async (dir, filename, signal) => {
      const response = await client.fetchImpl(previewUrl(dir, filename), { signal })
      if (!response.ok) {
        throw await parseErrorResponse(response)
      }
      // 成功：只关心状态码，立刻放弃响应体（真正的渲染由 `<iframe>` 自己发起）
      try {
        await response.body?.cancel()
      } catch {
        /* 忽略：预检不需要响应体 */
      }
    },

    remove: async (dir, filename) => {
      // `del()` 不支持查询参数；删除以资源定位（dir+filename）表达，故走通用 `request`
      await client.request<void>('/api/files', { method: 'DELETE', query: { dir, filename } })
    },

    workspace: () => client.get<WorkspaceResponse>('/api/files/workspace'),
  }
}
