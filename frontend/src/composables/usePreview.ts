
import { computed, ref, type Ref } from 'vue'

import type { FilesApi } from '../api/files'
import type { ErrorInfo, FileReference, PreviewWorkbook } from '../api/types'
import { resolvePreviewKind } from '../utils/file-kind'
import { toErrorInfo } from '../utils/error-message'
import { splitProducedPath } from '../utils/produced-display'
import { probeRenderable } from '../utils/preview-probe'
import { isSameOrigin, type ViewLinkTarget } from '../utils/view-link'
import { useSession } from './useAppSession'

export type PanelView = 'list' | 'content'

export type PreviewTarget =
  | { kind: 'none' }
  | { kind: 'file'; dir: string; filename: string }
  /**
   * 同源地址（`viewUrl` / `filePath` 归一化后的绝对 href）。
   *
   * `renderMode` 由预检结果决定：`iframe` = 可内联渲染；`download` = 需下载
   * （响应头声明 `attachment`，或类型不可内联）。
   */
  | { kind: 'url'; url: string; name: string; renderMode: 'iframe' | 'download' }

export interface PreviewContent {
  renderMode: 'text' | 'sheet' | 'pdf' | 'image' | 'html' | 'download' | 'error'
  text: string | null
  /**
   * 表格内容（仅 `renderMode === 'sheet'`）。
   *
   * 结构由服务端给全（`rows` / `numericCols` / `merges`），前端只渲染——不解析 CSV、
   * 不判断数字列，避免两套口径。
   */
  workbook?: PreviewWorkbook | null
  url: string | null
  error: ErrorInfo | null
}

export interface PreviewDeps {
  files: FilesApi
}

export interface PreviewStore {
  open: Readonly<Ref<boolean>>
  view: Readonly<Ref<PanelView>>
  target: Readonly<Ref<PreviewTarget>>
  content: Readonly<Ref<PreviewContent | null>>
  loading: Readonly<Ref<boolean>>
  maximized: Readonly<Ref<boolean>>
  /**
   * 当前内容是否**可放大**（"有版面"的两类：同源 `viewUrl` 的 iframe、本地 PDF / 图片）。
   * 判据的**唯一实现**在本文件（FR-010）；组件只消费布尔值，MUST NOT 自行判第二遍。
   */
  maximizable: Readonly<Ref<boolean>>
  maximizeToggleVisible: Readonly<Ref<boolean>>
  /** 放大 ↔ 缩小（同一入口）；不可放大且未放大时**无操作** */
  toggleMaximize(): void
  /** 退出放大（幂等，供 Esc / 收起路径使用） */
  restoreMaximize(): void
  openList(): void
  openFile(reference: FileReference): Promise<void>
  openView(item: ViewLinkTarget): Promise<void>
  backToList(): void
  /** 文件被删除后的收敛：若正在看该文件则退回列表态，否则不动 */
  onFileRemoved(reference: FileReference): void
  openLink(href: string): void
  close(): void
  /** 触发下载（无大小上限，走直链） */
  download(reference: FileReference): void
}

export function createPreviewStore(deps: PreviewDeps): PreviewStore {
  const open = ref(false)
  const view = ref<PanelView>('list')
  const target = ref<PreviewTarget>({ kind: 'none' })
  const content = ref<PreviewContent | null>(null)
  const loading = ref(false)
  const maximized = ref(false)

  const maximizable = computed<boolean>(() => {
    if (view.value !== 'content') {
      return false
    }
    const current = target.value
    if (current.kind === 'url') {
      return current.renderMode === 'iframe'
    }
    if (current.kind !== 'file') {
      return false
    }
    const mode = content.value?.renderMode
    return mode === 'pdf' || mode === 'image' || mode === 'html' || mode === 'sheet'
  })

  /** 入口可见性：放大态必须始终留出口（见接口注释）。 */
  const maximizeToggleVisible = computed<boolean>(() => maximized.value || maximizable.value)

  /** 请求序号：后发请求覆盖先发结果，避免快速切换时旧响应回填。 */
  let requestId = 0

  function resetContent(): void {
    requestId += 1
    target.value = { kind: 'none' }
    content.value = null
    loading.value = false
    maximized.value = false
  }

  function toggleMaximize(): void {
    if (!maximizeToggleVisible.value) {
      return
    }
    maximized.value = !maximized.value
  }

  function restoreMaximize(): void {
    maximized.value = false
  }

  function openList(): void {
    // 列表态不持有预览内容：先清掉上一份，避免两份状态同时存在
    resetContent()
    view.value = 'list'
    open.value = true
  }

  function backToList(): void {
    resetContent()
    view.value = 'list'
  }

  function onFileRemoved(reference: FileReference): void {
    const current = target.value
    const isViewing =
      current.kind === 'file' &&
      current.dir === reference.dir &&
      current.filename === reference.filename
    // 正在看的内容被删掉了：退回列表，避免停留在一个已不存在的文件上
    if (isViewing) {
      backToList()
    }
  }

  async function openFile(reference: FileReference): Promise<void> {
    const { dir, filename } = reference
    open.value = true
    view.value = 'content'
    target.value = { kind: 'file', dir, filename }

    const kind = resolvePreviewKind(filename)

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

    if (kind === 'pdf' || kind === 'image' || kind === 'html') {
      // 超限（413）/不存在（404）必须在进入前拦住，否则只会渲染出浏览器错误页（FR-048）
      const current = (requestId += 1)
      loading.value = true
      content.value = null
      try {
        await deps.files.probePreview(dir, filename)
        if (current !== requestId) {
          return
        }
        content.value = {
          renderMode: kind,
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

    if (kind === 'sheet') {
      const sheetRequest = (requestId += 1)
      loading.value = true
      content.value = null

      try {
        const workbook = await deps.files.fetchPreviewWorkbook(dir, filename)
        if (sheetRequest !== requestId) {
          return
        }
        content.value = {
          renderMode: 'sheet',
          text: null,
          workbook,
          url: null,
          error: null,
        }
      } catch (cause) {
        if (sheetRequest !== requestId) {
          return
        }
        content.value = {
          renderMode: 'error',
          text: null,
          url: deps.files.downloadUrl(dir, filename),
          error: toErrorInfo(cause),
        }
      } finally {
        if (sheetRequest === requestId) {
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
      content.value = {
        renderMode: 'text',
        text,
        url: null,
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
  }

  async function openView(item: ViewLinkTarget): Promise<void> {
    if (item.kind === 'file' && item.filePath !== undefined) {
      await openFile(splitProducedPath(item.filePath))
      return
    }

    const { url, name } = item
    if (!isSameOrigin(url)) {
      openLink(url)
      return
    }

    const current = (requestId += 1)
    open.value = true
    view.value = 'content'
    target.value = { kind: 'none' }
    content.value = null
    loading.value = true

    const outcome = await probeRenderable(url)
    if (current !== requestId) return
    loading.value = false

    if (outcome === 'fallback') {
      // 预检拿不到结论：收起面板，交给外部跳转让用户自己看（降级不是异常，宪章原则九）
      close()
      openLink(url)
      return
    }

    target.value = {
      kind: 'url',
      url,
      name,
      renderMode: outcome === 'renderable' ? 'iframe' : 'download',
    }
  }

  function openLink(href: string): void {
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
    resetContent()
    view.value = 'list'
    open.value = false
  }

  return {
    open,
    view,
    target,
    content,
    loading,
    maximized,
    maximizable,
    maximizeToggleVisible,
    toggleMaximize,
    restoreMaximize,
    openList,
    openFile,
    openView,
    backToList,
    onFileRemoved,
    openLink,
    close,
    download,
  }
}

export function usePreview(): PreviewStore {
  return useSession().preview
}
