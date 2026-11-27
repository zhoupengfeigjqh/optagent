
import type { Message, ToolCallRecord, ViewLink } from '../api/types'

export interface ToolCallItem {
  callId: string
  name: string
  label?: string
  status: 'running' | 'success' | 'error'
  durationMs?: number
  size?: number
  content?: string
  artifactSize?: number
  summary?: string
  /** 记录正文被截断；`size > artifactSize` 表示副本本身也被上限截断 */
  truncated?: boolean
  argsDigest?: Record<string, string>
  viewLinks?: ViewLink[]
}

export interface StreamingToolCall {
  call_id: string
  name: string
  label?: string
  status: 'running' | 'success' | 'error'
}

export function toolCallItemsOf(message: Message): ToolCallItem[] {
  return (message.tool_calls ?? []).map(toToolCallItem)
}

export function toToolCallItem(record: ToolCallRecord): ToolCallItem {
  return {
    callId: record.call_id,
    name: record.name,
    ...(record.label !== undefined && record.label !== '' ? { label: record.label } : {}),
    status: record.status,
    ...(record.duration_ms !== undefined ? { durationMs: record.duration_ms } : {}),
    ...(record.size !== undefined ? { size: record.size } : {}),
    ...(record.content !== undefined ? { content: record.content } : {}),
    ...(record.artifact_size !== undefined ? { artifactSize: record.artifact_size } : {}),
    ...(record.summary !== undefined ? { summary: record.summary } : {}),
    ...(record.truncated === true ? { truncated: true } : {}),
    ...(record.args_digest !== undefined ? { argsDigest: record.args_digest } : {}),
    ...(record.view_links !== undefined ? { viewLinks: record.view_links } : {}),
  }
}

export function collectToolViewLinks(items: readonly ToolCallItem[]): ViewLink[] {
  const links: ViewLink[] = []
  for (const item of items) {
    if (item.viewLinks !== undefined) links.push(...item.viewLinks)
  }
  return links
}

export function streamingToolCallItem(call: StreamingToolCall): ToolCallItem {
  return {
    callId: call.call_id,
    name: call.name,
    ...(call.label !== undefined && call.label !== '' ? { label: call.label } : {}),
    status: call.status,
  }
}

export function toolDisplayName(item: { name: string; label?: string }): string {
  return item.label !== undefined && item.label !== '' ? item.label : item.name
}

export function toolStatusLabel(status: ToolCallItem['status'], live: boolean): string {
  if (status === 'success') return '已完成'
  if (status === 'error') return '失败'
  return live ? '进行中' : '未完成'
}

/**
 * 是否已有终态（= 是否**可展开看结果**）。
 *
 * 规则只有这一条来源（`TR-33`）：`running` 无论何种语境都没有结果可看，展开只会是空壳。
 * 组件与测试都 MUST 用它判断，MUST NOT 各自写 `status !== 'running'`。
 */
export function isToolCallFinished(status: ToolCallItem['status']): boolean {
  return status !== 'running'
}

export interface ToolCallStats {
  total: number
  errors: number
}

export function summarizeToolCalls(items: ToolCallItem[]): ToolCallStats {
  let errors = 0
  for (const item of items) {
    if (item.status === 'error') errors += 1
  }
  return { total: items.length, errors }
}

/**
 * 本轮分组的稳定键 = **该轮第一次调用的 `call_id`**。
 *
 * 为什么不按消息 id：流式气泡的合成消息 `id` 为空串、历史消息才是真 id，用它做键会让
 * 查看态在交接时丢失（`TR-36`）。首个 `call_id` 在两条路径上都不变——流式只追加不重排，
 * 历史按"首次出现顺序"合并（`tool-events.readAll`）。
 */
export function toolGroupKey(items: ToolCallItem[]): string {
  return items[0]?.callId ?? ''
}

export function formatArgsDigest(digest: Record<string, string>): string {
  return Object.entries(digest)
    .map(([key, value]) => `${key}=${value}`)
    .join('  ')
}
