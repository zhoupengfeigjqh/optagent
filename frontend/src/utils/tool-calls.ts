/**
 * 工具调用记录的展示模型（002 特性）
 *
 * 两个来源统一成一个结构，好让同一个卡片组件既服务**历史态**（后端下发）
 * 又服务**流式态**（SSE 瞬态）：
 * - 历史：`Message.tool_calls`（snake_case 契约）→ `ToolCallItem`
 * - 流式：`useChatStream.toolCalls`（仅名称与状态，无结果）
 */

import type { Message, ToolCallRecord } from '../api/types'

/** 工具调用卡片的展示模型。 */
export interface ToolCallItem {
  callId: string
  name: string
  /**
   * `running` = 结果还没到。两种语境文案不同（见 `toolStatusLabel`）：
   * 流式进行中 → `进行中`；非流式（中断/失败轮、历史里只有开始行的记录）→ `未完成`
   */
  status: 'running' | 'success' | 'error'
  durationMs?: number
  /** 结果字节数 */
  size?: number
  /** 内联结果正文（小结果，随详情下发，展开即可见） */
  content?: string
  /** 外置正文大小（有值 = 展开时才拉取） */
  artifactSize?: number
  /** 规则提取的摘要（外置结果的卡片说明） */
  summary?: string
  /** 结果被落盘上限截断 */
  truncated?: boolean
  /** 入参短标量摘要（原文不下发） */
  argsDigest?: Record<string, string>
}

/** 流式瞬态工具项（SSE 只给名称与状态）。 */
export interface StreamingToolCall {
  call_id: string
  name: string
  status: 'running' | 'success' | 'error'
}

/** 历史消息的工具记录 → 展示模型（无记录返回空数组，调用方无需判空）。 */
export function toolCallItemsOf(message: Message): ToolCallItem[] {
  return (message.tool_calls ?? []).map(toToolCallItem)
}

/** 契约记录 → 展示模型（字段名转换集中在此，组件不感知 snake_case）。 */
export function toToolCallItem(record: ToolCallRecord): ToolCallItem {
  return {
    callId: record.call_id,
    name: record.name,
    status: record.status,
    ...(record.duration_ms !== undefined ? { durationMs: record.duration_ms } : {}),
    ...(record.size !== undefined ? { size: record.size } : {}),
    ...(record.content !== undefined ? { content: record.content } : {}),
    ...(record.artifact_size !== undefined ? { artifactSize: record.artifact_size } : {}),
    ...(record.summary !== undefined ? { summary: record.summary } : {}),
    ...(record.truncated === true ? { truncated: true } : {}),
    ...(record.args_digest !== undefined ? { argsDigest: record.args_digest } : {}),
  }
}

/** 流式瞬态 → 展示模型。 */
export function streamingToolCallItem(call: StreamingToolCall): ToolCallItem {
  return { callId: call.call_id, name: call.name, status: call.status }
}

/**
 * 工具调用状态的中文标签（文案**唯一来源**，组件 MUST NOT 各写一套）。
 *
 * `running` 有**两种语境**，必须分流（`TR-33`）：
 * - `live`（本轮仍在流式进行中）：结果稍后还会到 → `进行中`
 * - 非 `live`（中断/失败轮，或历史里只有开始行的记录）：它**不会再动** → `未完成`
 *   —— 此时显示"进行中"是假状态，违反「MUST NOT 假装正常」（宪章原则九）
 */
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

/** 本轮调用的计数摘要（折叠态「本轮 N 次调用 · 报错 M 次」的唯一来源）。 */
export interface ToolCallStats {
  /** 调用**次数**（同一工具调两次算 2 次） */
  total: number
  /** 失败次数（`running` 不计入） */
  errors: number
}

/** 统计本轮调用：总数 + 报错数（单次遍历）。 */
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

/** 体积的人类可读形式（与后端 `formatBytes` 同口径，便于前后端文案一致）。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 耗时的紧凑形式（毫秒 → `84ms` / `1.6s`）。 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** 入参摘要 → 一行可读文本（`path=数据准备/x.csv`）。 */
export function formatArgsDigest(digest: Record<string, string>): string {
  return Object.entries(digest)
    .map(([key, value]) => `${key}=${value}`)
    .join('  ')
}
