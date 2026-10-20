/**
 * 文件类型分派与上传预校验（纯函数）
 *
 * 预览分派与后端 `GET /api/files/preview` 的 Content-Type 映射一一对应
 * （`contracts/backend-api.md` §5.4、`research.md` D12）：
 * `.txt` / `.csv` / `.json` → 文本内联；`.pdf` → iframe 内联；`.html` → **沙箱** iframe 内联；
 * `.xlsx` / `.xls` / `.zip` → 回退下载；其余不支持。
 *
 * 2026-10-13：`.zip` 归入 `download`（数据准备目录现允许 `scenario.data_prep_uploads` 配置 `.zip`，
 * 压缩包无内联预览形态，归下载而非 `unsupported`）。
 * 2026-10-20：`.html` 归入 `html`（文件空间里点开即渲染，与 PDF 同形态）。它是**用户上传的
 * 可执行内容**，渲染方 MUST 加 `sandbox`，后端同时下发 `CSP: sandbox` 兜底。
 */

import { MAX_UPLOAD_BYTES } from '../constants/limits'

/** 预览渲染方式。 */
export type PreviewKind = 'text' | 'pdf' | 'image' | 'html' | 'download' | 'unsupported'

/** 可内联展示为文本的扩展名。 */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['.txt', '.csv', '.json'])

/** 可内联展示的 PDF 扩展名。 */
const PDF_EXTENSION = '.pdf'

/** 可沙箱内联展示的 HTML 扩展名（脚本由 `sandbox` 关闭）。 */
const HTML_EXTENSION = '.html'

/** 可用 <img> 内联展示的图片扩展名（.tif/.tiff 浏览器普遍不支持，归 download）。 */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.bmp',
  '.webp',
  '.gif',
])

/** 需回退下载的扩展名。 */
const DOWNLOAD_EXTENSIONS: ReadonlySet<string> = new Set(['.xlsx', '.xls', '.zip', '.tif', '.tiff'])

/** 上传预校验结果。 */
export interface UploadPrecheckResult {
  ok: boolean
  /** 不合规原因：`FILE_TOO_LARGE` 超过 5MB；`VALIDATION_FAILED` 扩展名不在白名单 */
  code?: 'FILE_TOO_LARGE' | 'VALIDATION_FAILED'
}

/**
 * 取小写扩展名（含点）。
 *
 * - `report.CSV` → `.csv`（大小写不敏感）
 * - `archive.tar.gz` → `.gz`（只取最后一段）
 * - `noext` / `.gitkeep` → `''`
 */
export function fileExtension(filename: string): string {
  const index = filename.lastIndexOf('.')
  if (index <= 0) {
    return ''
  }
  return filename.slice(index).toLowerCase()
}

/** 按扩展名分派预览方式；未知扩展名 → `unsupported`。 */
export function resolvePreviewKind(filename: string): PreviewKind {
  const extension = fileExtension(filename)
  if (TEXT_EXTENSIONS.has(extension)) {
    return 'text'
  }
  if (extension === PDF_EXTENSION) {
    return 'pdf'
  }
  if (extension === HTML_EXTENSION) {
    return 'html'
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }
  if (DOWNLOAD_EXTENSIONS.has(extension)) {
    return 'download'
  }
  return 'unsupported'
}

/**
 * 上传前客户端预校验（FR-010 + 003 按空间白名单）。
 *
 * `allowedExtensions` 取**目标目录**的 `upload_extensions`（workspace 接口下发；2026-10-13 起为目录级）；
 * 未传（工作空间尚未加载）时只校验大小，扩展名交给后端兜底。
 * 不合规时调用方 MUST **不发请求**，直接把该项置为失败并展示原因。
 */
export function isUploadAllowed(
  file: { name: string; size: number },
  allowedExtensions?: readonly string[],
): UploadPrecheckResult {
  if (Number.isFinite(file.size) && file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE' }
  }

  if (allowedExtensions && allowedExtensions.length > 0) {
    const extension = fileExtension(file.name)
    if (!allowedExtensions.includes(extension)) {
      return { ok: false, code: 'VALIDATION_FAILED' }
    }
  }

  return { ok: true }
}
