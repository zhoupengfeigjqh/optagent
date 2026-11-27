
import { parseErrorResponse, type HttpClient } from './http'
import type {
  PreviewWorkbook,
  RuleFileResponse,
  UploadResponse,
  WorkspaceFile,
  WorkspaceResponse,
} from './types'

export interface FilesApi {
  upload(dir: string, file: File | Blob, filename?: string): Promise<UploadResponse>
  list(dir: string): Promise<WorkspaceFile[]>
  /** `GET /api/files/download?dir=&filename=` 直链（无大小上限） */
  downloadUrl(dir: string, filename: string): string
  previewUrl(dir: string, filename: string): string
  fetchPreviewText(dir: string, filename: string, signal?: AbortSignal): Promise<string>
  fetchPreviewWorkbook(dir: string, filename: string, signal?: AbortSignal): Promise<PreviewWorkbook>
  probePreview(dir: string, filename: string, signal?: AbortSignal): Promise<void>
  remove(dir: string, filename: string): Promise<void>
  /** `GET /api/files/workspace` → 空间树（数据准备子目录数随场景，另加临时空间自身） */
  workspace(): Promise<WorkspaceResponse>
  rules(): Promise<RuleFileResponse>
}

export function createFilesApi(client: HttpClient): FilesApi {
  const previewUrl = (dir: string, filename: string): string =>
    client.url('/api/files/preview', { dir, filename })

  return {
    upload: (dir, file, filename) => {
      const form = new FormData()
      // 后端仍兼容，退回「先收后验」，结果一致仅时机不同）
      form.append('dir', dir)
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

    fetchPreviewWorkbook: async (dir, filename, signal) => {
      const response = await client.fetchImpl(previewUrl(dir, filename), { signal })
      if (!response.ok) {
        throw await parseErrorResponse(response)
      }
      return (await response.json()) as PreviewWorkbook
    },

    probePreview: async (dir, filename, signal) => {
      const response = await client.fetchImpl(previewUrl(dir, filename), { signal })
      if (!response.ok) {
        throw await parseErrorResponse(response)
      }
      try {
        await response.body?.cancel()
      } catch {
        /* 忽略：预检不需要响应体 */
      }
    },

    remove: async (dir, filename) => {
      await client.request<void>('/api/files', { method: 'DELETE', query: { dir, filename } })
    },

    workspace: () => client.get<WorkspaceResponse>('/api/files/workspace'),

    rules: () => client.get<RuleFileResponse>('/api/files/rules'),
  }
}
