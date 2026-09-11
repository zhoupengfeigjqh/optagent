/**
 * 右侧预览区状态（FR-002、FR-045~FR-048）
 *
 * 两条互斥路径：
 * - **外部地址**（`http(s)://`）：直接 `window.open` 跳转，**MUST NOT** 改变 `target`（V-10）
 * - **空间目录文件**：进入 `target`，按扩展名分派渲染方式（V-11）
 */

import { ref, type Ref } from 'vue'

import type { FilesApi } from '../api/files'
import type { ErrorInfo, FileReference } from '../api/types'
import { resolvePreviewKind } from '../utils/file-kind'
import { toErrorInfo } from '../utils/error-message'
import { useSession } from './useAppSession'

/** 预览目标：`none` 表示占位/收起态。 */
export type PreviewTarget = { kind: 'none' } | { kind: 'file'; dir: string; filename: string }

/** 预览内容（加载结果）。 */
export interface PreviewContent {
  renderMode: 'text' | 'pdf' | 'download' | 'error'
  /** 文本类内容（`.txt` / `.csv` / `.json`） */
  text: string | null
  /** `.pdf` 的 `<iframe>` 地址，或下载直链 */
  url: string | null
  error: ErrorInfo | null
}

/** 构造参数。 */
export interface PreviewDeps {
  files: FilesApi
}

/** 预览 composable 契约。 */
export interface PreviewStore {
  target: Readonly<Ref<PreviewTarget>>
  content: Readonly<Ref<PreviewContent | null>>
  loading: Readonly<Ref<boolean>>
  /** 打开空间目录文件的内联预览 */
  openFile(reference: FileReference): Promise<void>
  /** 外部地址直接跳转（不改变预览目标） */
  openLink(href: string): void
  /** 收起预览区 */
  close(): void
  /** 触发下载（无大小上限，走直链） */
  download(reference: FileReference): void
}

/** 创建预览状态。 */
export function createPreviewStore(deps: PreviewDeps): PreviewStore {
  const target = ref<PreviewTarget>({ kind: 'none' })
  const content = ref<PreviewContent | null>(null)
  const loading = ref(false)

  /** 请求序号：后发请求覆盖先发结果，避免快速切换时旧响应回填。 */
  let requestId = 0

  async function openFile(reference: FileReference): Promise<void> {
    const { dir, filename } = reference
    target.value = { kind: 'file', dir, filename }

    const kind = resolvePreviewKind(filename)

    // `.xlsx` 与未知类型：不内联，回退下载引导（V-11）
    if (kind === 'download' || kind === 'unsupported') {
      content.value = {
        renderMode: 'download',
        text: null,
        url: deps.files.downloadUrl(dir, filename),
        error: null,
      }
      loading.value = false
      return
    }

    if (kind === 'pdf') {
      // 先预检：`.pdf` 交给 `<iframe>` 后前端读不到响应体，超限（413）/不存在（404）
      // 必须在进入 iframe 前拦住，否则只会渲染出浏览器错误页（FR-048）
      const current = (requestId += 1)
      loading.value = true
      content.value = null
      try {
        await deps.files.probePreview(dir, filename)
        if (current !== requestId) {
          return
        }
        content.value = {
          renderMode: 'pdf',
          text: null,
          url: deps.files.previewUrl(dir, filename),
          error: null,
        }
      } catch (cause) {
        if (current !== requestId) {
          return
        }
        content.value = {
          renderMode: 'error',
          text: null,
          url: deps.files.downloadUrl(dir, filename),
          error: toErrorInfo(cause),
        }
      } finally {
        if (current === requestId) {
          loading.value = false
        }
      }
      return
    }

    const current = (requestId += 1)
    loading.value = true
    content.value = null

    try {
      const text = await deps.files.fetchPreviewText(dir, filename)
      if (current !== requestId) {
        return
      }
      content.value = { renderMode: 'text', text, url: null, error: null }
    } catch (cause) {
      if (current !== requestId) {
        return
      }
      // 超限（413）与不存在（404）都进入错误态并提供下载引导（FR-048）
      content.value = {
        renderMode: 'error',
        text: null,
        url: deps.files.downloadUrl(dir, filename),
        error: toErrorInfo(cause),
      }
    } finally {
      if (current === requestId) {
        loading.value = false
      }
    }
  }

  function openLink(href: string): void {
    // 外部地址直接跳转：刻意不改动 target（V-10）
    if (typeof window === 'undefined') {
      return
    }
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  function download(reference: FileReference): void {
    if (typeof window === 'undefined') {
      return
    }
    const link = document.createElement('a')
    link.href = deps.files.downloadUrl(reference.dir, reference.filename)
    link.download = reference.filename
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  function close(): void {
    requestId += 1
    target.value = { kind: 'none' }
    content.value = null
    loading.value = false
  }

  return { target, content, loading, openFile, openLink, close, download }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function usePreview(): PreviewStore {
  return useSession().preview
}
