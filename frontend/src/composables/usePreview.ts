/**
 * 右侧工作空间面板（FR-002、FR-031、FR-045~FR-048）
 *
 * **单区域双视图**：右侧 1/3 只有这一个面板，内部在「文件空间列表」与「文件内容」之间互换，
 * 两者不并存、不叠加（`view` 决定渲染哪一侧）。
 * - `view='list'`：9 个固定分组的文件空间；分组数据与折叠状态在 `useWorkspace`
 * - `view='content'`：当前文件的内联预览，按扩展名分派渲染方式（V-11）
 *
 * 两条互斥路径：
 * - **外部地址**（`http(s)://`）：直接 `window.open` 跳转，**MUST NOT** 改变面板状态（V-10）
 * - **空间目录文件**：打开面板并进入内容态
 */

import { ref, type Ref } from 'vue'

import type { FilesApi } from '../api/files'
import type { ErrorInfo, FileReference } from '../api/types'
import { resolvePreviewKind } from '../utils/file-kind'
import { toErrorInfo } from '../utils/error-message'
import { useSession } from './useAppSession'

/** 面板视图。 */
export type PanelView = 'list' | 'content'

/** 预览目标：`none` 表示内容态无目标（列表态恒为 `none`）。 */
export type PreviewTarget = { kind: 'none' } | { kind: 'file'; dir: string; filename: string }

/** 预览内容（加载结果）。 */
export interface PreviewContent {
  renderMode: 'text' | 'pdf' | 'image' | 'download' | 'error'
  /** 文本类内容（`.txt` / `.csv` / `.json`） */
  text: string | null
  /** `.pdf` 的 `<iframe>` 地址、图片的 `<img>` 地址，或下载直链 */
  url: string | null
  error: ErrorInfo | null
}

/** 构造参数。 */
export interface PreviewDeps {
  files: FilesApi
}

/** 预览 composable 契约。 */
export interface PreviewStore {
  /** 面板是否展开（展开即占据右侧 1/3，中栏让宽，FR-002） */
  open: Readonly<Ref<boolean>>
  /** 当前视图（列表 / 内容） */
  view: Readonly<Ref<PanelView>>
  target: Readonly<Ref<PreviewTarget>>
  content: Readonly<Ref<PreviewContent | null>>
  loading: Readonly<Ref<boolean>>
  /** 展开面板并停在文件空间列表（工具栏入口） */
  openList(): void
  /** 展开面板并内联预览该文件（面板内点击 / 消息内引用，FR-046） */
  openFile(reference: FileReference): Promise<void>
  /** 从内容态返回列表态（面板不收起） */
  backToList(): void
  /** 文件被删除后的收敛：若正在看该文件则退回列表态，否则不动 */
  onFileRemoved(reference: FileReference): void
  /** 外部地址直接跳转（不改变面板状态） */
  openLink(href: string): void
  /** 收起面板 */
  close(): void
  /** 触发下载（无大小上限，走直链） */
  download(reference: FileReference): void
}

/** 创建预览状态。 */
export function createPreviewStore(deps: PreviewDeps): PreviewStore {
  const open = ref(false)
  const view = ref<PanelView>('list')
  const target = ref<PreviewTarget>({ kind: 'none' })
  const content = ref<PreviewContent | null>(null)
  const loading = ref(false)

  /** 请求序号：后发请求覆盖先发结果，避免快速切换时旧响应回填。 */
  let requestId = 0

  /** 清空内容态（不动 `open`），用于列表态与内容态之间的单向收敛。 */
  function resetContent(): void {
    requestId += 1
    target.value = { kind: 'none' }
    content.value = null
    loading.value = false
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

    if (kind === 'pdf' || kind === 'image') {
      // 先预检：`.pdf` 交给 `<iframe>`、图片交给 `<img>` 后前端读不到响应体，
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
    // 外部地址直接跳转：刻意不改动面板状态（V-10）
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
    openList,
    openFile,
    backToList,
    onFileRemoved,
    openLink,
    close,
    download,
  }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function usePreview(): PreviewStore {
  return useSession().preview
}
