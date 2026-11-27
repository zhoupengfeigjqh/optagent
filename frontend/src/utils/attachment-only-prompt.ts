export const ATTACHMENT_ONLY_SINGLE = '请查看这个文件'
export const ATTACHMENT_ONLY_MULTI = '请查看这些文件'

export function attachmentOnlyPrompt(count: number): string {
  return count >= 2 ? ATTACHMENT_ONLY_MULTI : ATTACHMENT_ONLY_SINGLE
}
