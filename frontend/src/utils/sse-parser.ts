/**
 * SSE 文本块解析器（纯函数，无副作用）
 *
 * 后端按 `event: {type}\ndata: {JSON}\n\n` 写入（`contracts/backend-api.md` §4.2）。
 * 手写解析的必要性见 `research.md` D5：发消息端点为 POST，浏览器原生 `EventSource` 只支持 GET。
 *
 * 关键约束：`event:` / `data:` 可能被 TCP 分片截断，因此解析器 MUST 支持**跨 chunk 行缓冲**——
 * 不完整的尾部一律保留在 `rest` 中，与下一个 chunk 拼接后再解析。
 */

import type { RawSseEvent } from '../api/types'

/** SSE 默认事件名（未声明 `event:` 字段时）。 */
const DEFAULT_EVENT_NAME = 'message'

/**
 * 解析一个文本块，返回已完成的事件与**未完成**的尾部。
 *
 * @param buffer 上一次调用返回的 `rest`（首次传空串）
 * @param chunk  本次从流中读到的文本片段
 * @returns `events` 为本次解析出的完整事件；`rest` 为不完整尾部，需与下一 chunk 拼接
 */
export function parseSseChunk(
  buffer: string,
  chunk: string,
): { events: RawSseEvent[]; rest: string } {
  const combined = buffer + chunk
  // 事件以空行分隔（容忍 \n\n 与 \r\n\r\n 两种换行）
  const blocks = combined.split(/\r?\n\r?\n/)
  // 最后一段没有以空行结束 → 尚未完整，留待下一个 chunk
  const rest = blocks.pop() ?? ''

  const events: RawSseEvent[] = []
  for (const block of blocks) {
    const event = parseBlock(block)
    if (event) {
      events.push(event)
    }
  }

  return { events, rest }
}

/** 解析单个事件块；纯注释块或空块返回 `null`。 */
function parseBlock(block: string): RawSseEvent | null {
  if (block.trim() === '') {
    return null
  }

  let eventName = ''
  const dataLines: string[] = []

  for (const line of block.split(/\r?\n/)) {
    // 注释行（以 `:` 开头）与空行按规范忽略
    if (line === '' || line.startsWith(':')) {
      continue
    }

    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? '' : line.slice(separator + 1)
    // 规范：冒号后若紧跟一个空格，需去掉该空格
    if (value.startsWith(' ')) {
      value = value.slice(1)
    }

    if (field === 'event') {
      eventName = value
    } else if (field === 'data') {
      dataLines.push(value)
    }
  }

  if (eventName === '' && dataLines.length === 0) {
    return null
  }

  return {
    event: eventName === '' ? DEFAULT_EVENT_NAME : eventName,
    data: dataLines.join('\n'),
  }
}
