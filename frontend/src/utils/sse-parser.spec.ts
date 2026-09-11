import { describe, expect, it } from 'vitest'

import { parseSseChunk } from './sse-parser'

/** 后端实际写入格式：`event: {type}\ndata: {JSON}\n\n`。 */
function frame(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

describe('parseSseChunk', () => {
  it('解析单个完整事件', () => {
    const result = parseSseChunk('', frame('content', '{"delta":"你好"}'))

    expect(result.events).toEqual([{ event: 'content', data: '{"delta":"你好"}' }])
    expect(result.rest).toBe('')
  })

  it('同一 chunk 中的多个事件全部解析', () => {
    const chunk =
      frame('thinking', '{"delta":"a"}') +
      frame('content', '{"delta":"b"}') +
      frame('done', '{"finish_reason":"completed"}')

    const result = parseSseChunk('', chunk)

    expect(result.events.map((item) => item.event)).toEqual(['thinking', 'content', 'done'])
    expect(result.rest).toBe('')
  })

  it('以空行分隔事件：缺少结尾空行的最后一帧保留在 rest 中', () => {
    const chunk = frame('content', '{"delta":"a"}') + 'event: done\ndata: {"finish_reason":"stop"}'

    const result = parseSseChunk('', chunk)

    expect(result.events).toEqual([{ event: 'content', data: '{"delta":"a"}' }])
    expect(result.rest).toBe('event: done\ndata: {"finish_reason":"stop"}')
  })

  it('跨 chunk 行缓冲：事件名与数据被 TCP 分片截断后仍可正确解析', () => {
    const full = frame('content', '{"delta":"hello world"}')
    const splitAt = 9 // 落在 "event: co|ntent" 中间

    const first = parseSseChunk('', full.slice(0, splitAt))
    expect(first.events).toEqual([])
    expect(first.rest).toBe(full.slice(0, splitAt))

    const second = parseSseChunk(first.rest, full.slice(splitAt))
    expect(second.events).toEqual([{ event: 'content', data: '{"delta":"hello world"}' }])
    expect(second.rest).toBe('')
  })

  it('逐字节喂入时最终仍能完整解析（最坏分片）', () => {
    const full = frame('tool_call', '{"call_id":"c1","name":"read_file","status":"running"}')

    let buffer = ''
    const events: { event: string; data: string }[] = []
    for (const char of full) {
      const step = parseSseChunk(buffer, char)
      buffer = step.rest
      events.push(...step.events)
    }

    expect(events).toEqual([
      { event: 'tool_call', data: '{"call_id":"c1","name":"read_file","status":"running"}' },
    ])
    expect(buffer).toBe('')
  })

  it('忽略注释行（以 `:` 开头）', () => {
    const chunk = ': 这是心跳注释\nevent: content\ndata: {"delta":"x"}\n\n'

    const result = parseSseChunk('', chunk)

    expect(result.events).toEqual([{ event: 'content', data: '{"delta":"x"}' }])
  })

  it('纯注释块不产生事件', () => {
    const result = parseSseChunk('', ': keep-alive\n\n')

    expect(result.events).toEqual([])
    expect(result.rest).toBe('')
  })

  it('容忍 \\r\\n 换行', () => {
    const result = parseSseChunk('', 'event: content\r\ndata: {"delta":"a"}\r\n\r\n')

    expect(result.events).toEqual([{ event: 'content', data: '{"delta":"a"}' }])
    expect(result.rest).toBe('')
  })

  it('多行 data 以换行拼接', () => {
    const result = parseSseChunk('', 'event: content\ndata: line1\ndata: line2\n\n')

    expect(result.events).toEqual([{ event: 'content', data: 'line1\nline2' }])
  })

  it('缺少 event 字段时使用默认事件名 message', () => {
    const result = parseSseChunk('', 'data: {"delta":"a"}\n\n')

    expect(result.events).toEqual([{ event: 'message', data: '{"delta":"a"}' }])
  })

  it('冒号后无空格时也能解析', () => {
    const result = parseSseChunk('', 'event:content\ndata:{"delta":"a"}\n\n')

    expect(result.events).toEqual([{ event: 'content', data: '{"delta":"a"}' }])
  })

  it('空输入不产生事件且 rest 为空', () => {
    const result = parseSseChunk('', '')

    expect(result.events).toEqual([])
    expect(result.rest).toBe('')
  })

  it('数据体中的空行不会误切事件（JSON 内无换行，属后端契约保证）', () => {
    const result = parseSseChunk('', frame('error', '{"error":{"code":"X","message":"m"}}'))

    expect(result.events).toEqual([
      { event: 'error', data: '{"error":{"code":"X","message":"m"}}' },
    ])
  })
})
