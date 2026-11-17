/**
 * 粘贴待发批次的「入参预校验」（2026-11-17，023 v1.3）
 *
 * 粘贴**不落盘**，所以校验发生在"粘进来那一刻"，不是发送时：不合格的文件当场就不进胶囊，
 * 用户不必写完整段话才发现格式不对。
 *
 * 与 `useUploads.upload()` 的差别只在**取舍方式**：`+` 上传是"逐文件置失败行、能传几个传几个"，
 * 这里由调用方**逐个取舍**——合格的进胶囊、不合格的由一条 toast 说明（v1.3 起不再整批作废：
 * 既然没有半成品落盘，就没有必要为了原子性牺牲便利）。
 *
 * 这里的纯函数只回答"哪些文件不合格"，不发请求、不改状态。
 * 另外两类失败（空间未就绪、超出引用上限）不属于某个文件的问题，不在这里表达——
 * 它们若变成一行 `failed`，用户会去点"重试"，而重试永远不可能成功。
 */
import { fileExtension, isUploadAllowed } from './file-kind'

/** 文件级不合格原因（与 `toUserMessage(..., 'upload')` 的码一一对应） */
export type BatchRejectCode = 'FILE_TOO_LARGE' | 'VALIDATION_FAILED'

/** 单个被拒文件 */
export interface BatchRejection {
  /** 在入参数组中的下标（文件名可能重复，不能只按名字回指） */
  index: number
  /** 原始文件名（提示文案用） */
  name: string
  code: BatchRejectCode
}

/**
 * 对整批文件做预校验，**不早停**：一次把所有不合格项都收集出来，用户一次看全。
 *
 * `allowedExtensions` MUST 为非空（目标目录/空间的白名单）。空数组意味着工作空间尚未加载，
 * 而 `isUploadAllowed` 对空名单是"不校验扩展名"——那等于绕过格式检查，调用方必须先拦截。
 */
export function precheckBatch(
  files: readonly File[],
  allowedExtensions: readonly string[],
): BatchRejection[] {
  const rejections: BatchRejection[] = []
  files.forEach((file, index) => {
    const check = isUploadAllowed({ name: file.name, size: file.size }, allowedExtensions)
    if (check.ok) return
    rejections.push({
      index,
      name: file.name,
      code: check.code === 'FILE_TOO_LARGE' ? 'FILE_TOO_LARGE' : 'VALIDATION_FAILED',
    })
  })
  return rejections
}

/**
 * 把整批拆成"能收下的"与"被拒的"（v1.3：粘贴侧逐文件取舍）。
 *
 * 返回的 `accepted` 保持原始顺序；`rejections` 里的 `index` 仍指**入参数组**下标，
 * 便于调用方把原因对回具体文件。
 */
export function partitionBatch(
  files: readonly File[],
  allowedExtensions: readonly string[],
): { accepted: File[]; rejections: BatchRejection[] } {
  const rejections = precheckBatch(files, allowedExtensions)
  if (rejections.length === 0) {
    return { accepted: [...files], rejections }
  }
  const rejected = new Set(rejections.map((item) => item.index))
  const accepted = files.filter((_file, index) => !rejected.has(index))
  return { accepted, rejections }
}

/**
 * 剪贴板文件的 MIME → 扩展名（**只映射白名单内类型**）。
 *
 * 部分来源（截图工具、网页复制图片）给到的 `File` 只有 MIME、没有扩展名，直接送上传会被
 * "格式不支持"拒掉。这里只补已知类型；MIME 不在表内一律不补（例如 `image/svg+xml`
 * 不映射 `.svg`），让它走正常拒绝路径——补名不能变相扩大白名单。
 */
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
}

/** 无扩展名时给剪贴板文件补一个可读名（`粘贴-<时间戳>-<序号>.<ext>`） */
export function pastedFileName(file: File, index: number): string {
  const name = typeof file.name === 'string' ? file.name.trim() : ''
  if (name !== '' && fileExtension(name) !== '') return name

  const extension = MIME_EXTENSIONS[(file.type || '').toLowerCase()]
  if (extension === undefined) return name

  const stem = name === '' || name === 'blob' ? `粘贴-${Date.now()}-${index + 1}` : name
  return `${stem}${extension}`
}

/**
 * 给剪贴板文件套上补好的名字（`File` 不可改名，只能重建）。
 *
 * 名字本来就合规时**原样返回**，避免无谓地复制 blob。
 */
export function withPastedName(file: File, index: number): File {
  const name = pastedFileName(file, index)
  if (name === file.name) return file
  return new File([file], name, { type: file.type, lastModified: file.lastModified })
}
