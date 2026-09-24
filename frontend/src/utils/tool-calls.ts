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
  /** `running` = 只有开始事件（进程中途退出），界面显示"未完成" */
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

/** 工具调用状态的中文标签。 */
export const TOOL_STATUS_LABEL: Readonly<Record<ToolCallItem['status'], string>> = {
  running: '进行中',
  success: '已完成',
  error: '失败',
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
