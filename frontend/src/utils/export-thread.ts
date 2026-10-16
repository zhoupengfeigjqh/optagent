/**
 * 会话导出为 Markdown（2026-10-16）。
 *
 * 纯函数：只做"会话 + 消息数组 → 文本"的映射，不碰 DOM、不发请求
 * （真正落盘那一步在 `utils/download.ts`，这样本文件可以直接断言文本）。
 *
 * 为什么导出 Markdown：agent 的正文本身就是 Markdown（标题 / 列表 / 表格 / 代码块），
 * 原样带走就能在文档工具里直接渲染；JSON 对"给人看"的场合还得再加工一次。
 */
import type { Conversation, Message } from '../api/types'
import { formatTimestamp } from './format'

/** 用户侧的角色标签：与界面同口径用"我"（模型侧用数字人名，缺省退回"助手"）。 */
const USER_LABEL = '我'

/** 文件名非法字符（Windows / macOS 通吃的保守集合）。 */
const FILENAME_UNSAFE = /[\\/:*?"<>|]/g

/** 引用文件的标注（与消息气泡里的 `@文件名` 同形）。 */
function referencesOf(message: Message): string {
  const attachments = message.attachments ?? []
  if (attachments.length === 0) return ''
  return attachments.map((item) => `@${item.filename}`).join('、')
}

/** 单条消息 → Markdown 片段（标题行 + 正文 + 元信息引用块）。 */
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

/**
 * 把会话渲染成 Markdown 全文。
 *
 * 消息之间用 `---` 分隔：标题行之外再给一道硬边界，长回答被工具卡片打断时更好读。
 */
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
