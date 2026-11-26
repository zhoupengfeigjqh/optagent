
import { MAX_UPLOAD_BYTES } from '../constants/limits'

export type PreviewKind =
  | 'text'
  | 'pdf'
  | 'image'
  | 'html'
  | 'sheet'
  | 'download'
  | 'unsupported'

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['.txt', '.csv', '.json', '.md'])

const PDF_EXTENSION = '.pdf'

const HTML_EXTENSION = '.html'

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.bmp',
  '.webp',
  '.gif',
])

const SHEET_EXTENSIONS: ReadonlySet<string> = new Set(['.xlsx'])

const DOWNLOAD_EXTENSIONS: ReadonlySet<string> = new Set(['.xls', '.zip', '.tif', '.tiff'])

export interface UploadPrecheckResult {
  ok: boolean
  code?: 'FILE_TOO_LARGE' | 'VALIDATION_FAILED'
}

export function fileExtension(filename: string): string {
  const index = filename.lastIndexOf('.')
  if (index <= 0) {
    return ''
  }
  return filename.slice(index).toLowerCase()
}

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
  if (SHEET_EXTENSIONS.has(extension)) {
    return 'sheet'
  }
  if (DOWNLOAD_EXTENSIONS.has(extension)) {
    return 'download'
  }
  return 'unsupported'
}

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
