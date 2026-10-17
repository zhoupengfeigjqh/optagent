/**
 * 右侧工作空间面板（FR-002、FR-031、FR-045~FR-048）
 *
 * **单区域双视图**：右侧 1/3 只有这一个面板，内部在「文件空间列表」与「内容态」之间互换，
 * 两者不并存、不叠加（`view` 决定渲染哪一侧）。
 * - `view='list'`：9 个固定分组的文件空间；分组数据与折叠状态在 `useWorkspace`
 * - `view='content'`：当前目标的渲染（`file` 按扩展名分派；`url` 按预检结果分派 iframe / 下载）
 *
 * 三条路径（2026-10-15 起，`filePath` 入口并入第 3 条）：
 * - **异源地址**：直接 `window.open` 跳转，**MUST NOT** 改变面板状态（V-10）
 * - **同源地址**：先 `probeRenderable` 预检响应头——可内联 → 面板 iframe；
 *   需下载 → 面板给下载入口；预检失败 → 收起面板并降级外部跳转
 * - **本地文件**（空间目录点击 / 消息里的 `filePath` 入口）：打开面板并按**扩展名**分派
 *   （文本 `<pre>` / PDF / 图片 / 下载引导，V-11）——同一份文件从不同入口进来，
 *   判据与渲染口径 MUST 一致
 *
 * **放大态**（2026-10-16，`specs/011-preview-maximize`）：内容"平铺整个视口"的瞬态状态。
 * 它是**呈现层**的状态，不改变 `target` / `content`、不发请求、不落盘（FR-006 / FR-007）。
 * 归属放这里而不是组件里，是为了让三条退出路径（`close` / `backToList` / `openList`）经
 * `resetContent()` **一处收敛**；"哪些内容可以放大"的判据也只在本文件写一次（FR-010）。
 */

import { computed, ref, type Ref } from 'vue'

import type { FilesApi } from '../api/files'
import type { ErrorInfo, FileReference } from '../api/types'
import { resolvePreviewKind } from '../utils/file-kind'
import { toErrorInfo } from '../utils/error-message'
import { splitProducedPath } from '../utils/produced-display'
import { probeRenderable } from '../utils/preview-probe'
import { isSameOrigin, type ViewLinkTarget } from '../utils/view-link'
import { useSession } from './useAppSession'

/** 面板视图。 */
export type PanelView = 'list' | 'content'

/** 预览目标：`none` 表示内容态无目标（列表态恒为 `none`）。 */
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
  /**
   * 放大态（011）：预览内容是否平铺整个视口。瞬态，不持久化、不写地址栏（FR-007）。
   */
  maximized: Readonly<Ref<boolean>>
  /**
   * 当前内容是否**可放大**（"有版面"的两类：同源 `viewUrl` 的 iframe、本地 PDF / 图片）。
   * 判据的**唯一实现**在本文件（FR-010）；组件只消费布尔值，MUST NOT 自行判第二遍。
   */
  maximizable: Readonly<Ref<boolean>>
  /**
   * 头部"放大 / 缩小"入口是否可见：`maximized || maximizable`。
   *
   * 带上 `maximized` 是必需的：放大态下切换目标会经过预检 / 加载窗口（`maximizable` 短暂为假），
   * 若入口随 `maximizable` 显隐，就会出现"全屏状态下没有缩小按钮"（违 FR-005）。
   */
  maximizeToggleVisible: Readonly<Ref<boolean>>
  /** 放大 ↔ 缩小（同一入口）；不可放大且未放大时**无操作** */
  toggleMaximize(): void
  /** 退出放大（幂等，供 Esc / 收起路径使用） */
  restoreMaximize(): void
  /** 展开面板并停在文件空间列表（工具栏入口） */
  openList(): void
  /** 展开面板并内联预览该文件（面板内点击 / 消息内引用，FR-046） */
  openFile(reference: FileReference): Promise<void>
  /**
   * 打开一个跳转入口（`ViewLinkTarget`）。
   *
   * - `kind: 'file'`（本地文件空间相对路径）→ 与"在文件空间里点文件"**同一条路**：
   *   按扩展名预览（文本 / PDF / 图片 / 下载引导）
   * - `kind: 'url'`：异源 → 新窗口跳转（不改面板状态）；同源 → 预检后进面板
   *   （iframe / 下载入口 / 预检失败降级外部跳转）
   */
  openView(item: ViewLinkTarget): Promise<void>
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
  const maximized = ref(false)

  /**
   * 可放大判据（唯一实现，FR-010）。
   *
   * 只看"有版面"的两类：① 同源 `viewUrl` 的内联 iframe；② 本地 PDF / 图片。
   * 其余（文本流、「需下载」引导、错误态、空内容态、列表态）一律不可放大——
   * 文本不因变宽而更可读，另两类的出口是"下载完整文件"，加了只是无效按钮（FR-013）。
   */
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
    return mode === 'pdf' || mode === 'image'
  })

  /** 入口可见性：放大态必须始终留出口（见接口注释）。 */
  const maximizeToggleVisible = computed<boolean>(() => maximized.value || maximizable.value)

  /** 请求序号：后发请求覆盖先发结果，避免快速切换时旧响应回填。 */
  let requestId = 0

  /**
   * 清空内容态（不动 `open`），用于列表态与内容态之间的单向收敛。
   *
   * 放大态在此一并归零：它依附于"正在看的内容"，内容一清空就没有"平铺什么"可言；
   * 三条路径（`close` / `backToList` / `openList`）因此自动退出放大（FR-007 / FR-032），
   * 而 `openFile` / `openView` 刻意**不走**这里，于是"放大态下换目标仍保持放大"（FR-012）。
   */
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

  /**
   * 打开一个跳转入口（`ViewLinkTarget`）。
   *
   * - **本地文件**（`kind: 'file'`）：不当地址处理，直接交给 `openFile()`——按扩展名分派、
   *   走预览接口与下载引导。同一份文件从消息里的 `filePath` 进来、还是从文件空间点进来，
   *   表现 MUST 一致（2026-10-15 统一；此前它被当成地址，文本文件会渲染成 iframe 裸文本，
   *   `.pdf` 超限时还会丢掉后端的结构化错误）。
   * - **异源**：`window.open` 直跳，**不改动面板状态**（V-10，与 `openLink` 同口径）
   * - **同源**：先 `probeRenderable` 预检响应头再决定渲染方式——
   *   `renderable` → iframe；`download` → 下载入口；`fallback`（网络错误 / 非 2xx）
   *   → 收起面板并降级为外部跳转（不让用户停在一个空面板上）
   */
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

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function usePreview(): PreviewStore {
  return useSession().preview
}
