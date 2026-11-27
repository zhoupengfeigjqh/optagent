import { formatBytes } from './format'
import type { ToolCallItem } from './tool-calls'

/** 无提示（模板据此渲染"无结果内容"兜底） */
export const NO_HINT = ''

export const LIVE_PENDING_HINT = '结果将在本轮结束后可查看'

export function emptyBodyHint(item: ToolCallItem, live: boolean): string {
  if (item.truncated === true) return NO_HINT
  if (!live) return NO_HINT
  if (item.status === 'error') return NO_HINT
  return LIVE_PENDING_HINT
}

export function resultHint(item: ToolCallItem): string {
  if (item.truncated !== true) return NO_HINT
  if (item.artifactSize === undefined) {
    return '结果过大，仅保留了前一部分（完整内容未保存，可让助手重新读取）'
  }
  return `结果过大，仅显示前一部分（完整正文 ${formatBytes(item.artifactSize)} 存于临时空间，可让助手读取）`
}
