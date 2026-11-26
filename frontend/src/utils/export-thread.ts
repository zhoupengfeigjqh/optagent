import type { Conversation, Message } from '../api/types'
import { formatTimestamp } from './format'

const USER_LABEL = '我'

/** 文件名非法字符（Windows / macOS 通吃的保守集合）。 */
const FILENAME_UNSAFE = /[\\/:*?"<>|]/g

function referencesOf(message: Message): string {
  const attachments = message.attachments ?? []
  if (attachments.length === 0) return ''
  return attachments.map((item) => `@${item.filename}`).join('、')
}

function messageToMarkdown(message: Message): string {
  const who = message.role === 'user' ? USER_LABEL : (message.agent_name ?? '助手')
  const lines: string[] = [`## ${who} · ${formatTimestamp(message.ts)}`, '']

  const body = message.content.trim()
  if (body !== '') lines.push(body)

  const references = referencesOf(message)
  if (references !== '') lines.push('', `> 引用：${references}`)

  // 失败轮：正文可能是空的，但"这一轮失败了"这件事必须留在文本里，
  // 否则导出稿里会出现一段无解释的空白
  if (message.status === 'failed') {
    lines.push('', `> 状态：本轮失败（${message.error?.code ?? 'UNKNOWN'}）`)
  }

  const tools = message.tool_calls ?? []
  if (tools.length > 0) {
    const names = tools.map((tool) => `${tool.name}（${tool.status}）`).join('、')
    lines.push('', `> 工具：${names}`)
  }

  return lines.join('\n')
}

export function threadToMarkdown(
  thread: Conversation,
  messages: Message[],
  exportedAt: Date = new Date(),
): string {
  const title = (thread.title ?? '').trim() || '未命名会话'
  const exportedOn = formatTimestamp(exportedAt.toISOString())
  const head = `> 数字人：${thread.agent_name} · 导出时间：${exportedOn} · 共 ${messages.length} 条消息`

  const blocks = messages.flatMap((message) => ['---', '', messageToMarkdown(message), ''])
  return [`# ${title}`, '', head, '', ...blocks].join('\n').trimEnd() + '\n'
}

/** 导出文件名：`<标题>.md`；标题为空时用会话 id 兜底，非法字符替换为 `_`。 */
export function exportFilename(thread: Conversation): string {
  const base = (thread.title ?? '').trim().replace(FILENAME_UNSAFE, '_')
  return base === '' ? `会话-${thread.thread_id.slice(0, 8)}.md` : `${base}.md`
}
