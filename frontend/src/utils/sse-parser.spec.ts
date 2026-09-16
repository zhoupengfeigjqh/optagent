/**
 * SSE 文本块解析器单测（`src/utils/sse-parser.ts`）
 *
 * 运行方式：`npm run test` / `npm run test:coverage`（本地执行）
 *
 * 手写解析的必要性见 `research.md` D5：发消息端点是 POST，浏览器原生 `EventSource` 只支持 GET。
 *
 * 本模块的关键约束是**跨 chunk 行缓冲**：TCP 分片可以切在任意字节上，
 * 包括 `event:` / `data:` 中间。若解析器把不完整尾部当成完整事件，
 * 症状是"流式回答偶发丢字或 JSON 解析失败"——只在特定网络条件下复现，极难排查。
 * 因此下面对"分片切在任意位置"专门用例。
 *
 * 另一条口径：`: ` 开头为**注释行**（常用于心跳），MUST 忽略而非产出空事件。
 */
import { describe, expect, it } from 'vitest'

import { parseSseChunk } from './sse-parser'

describe('parseSseChunk - 完整事件', () => {
  it('解析单个事件并返回空 rest', () => {
    expect(parseSseChunk('', 'event: content\ndata: {"delta":"hi"}\n\n')).toEqual({
      events: [{ event: 'content', data: '{"delta":"hi"}' }],
      rest: '',
    })
  })

  it('一个 chunk 内含多个事件', () => {
    const result = parseSseChunk('', 'event: a\ndata: 1\n\nevent: b\ndata: 2\n\n')
    expect(result.events).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ])
    expect(result.rest).toBe('')
  })

  it('未声明 event: 时回落到默认事件名 message', () => {
    expect(parseSseChunk('', 'data: hi\n\n').events).toEqual([{ event: 'message', data: 'hi' }])
  })

  it('多行 data 按换行拼接为一个负载', () => {
    expect(parseSseChunk('', 'event: e\ndata: a\ndata: b\n\n').events).toEqual([
      { event: 'e', data: 'a\nb' },
    ])
  })

  it('兼容 CRLF 换行的分隔与字段', () => {
    expect(parseSseChunk('', 'event: e\r\ndata: x\r\n\r\n').events).toEqual([
      { event: 'e', data: 'x' },
    ])
  })

  it('冒号后紧跟的空格按规范去掉；无空格亦可用', () => {
    expect(parseSseChunk('', 'data: x\n\n').events[0]?.data).toBe('x')
    expect(parseSseChunk('', 'data:x\n\n').events[0]?.data).toBe('x')
  })

  it('只有字段名无冒号 → 值按空串处理', () => {
    expect(parseSseChunk('', 'data\n\n').events).toEqual([{ event: 'message', data: '' }])
  })
})

describe('parseSseChunk - 不完整尾部', () => {
  it('末尾未以空行结束 → 整块留在 rest，不产出事件', () => {
    const result = parseSseChunk('', 'event: content\ndata: {"a"')
    expect(result.events).toEqual([])
    expect(result.rest).toBe('event: content\ndata: {"a"')
  })

  it('分片切在字段中间 → 拼接后仍能正确解析', () => {
    const first = parseSseChunk('', 'event: content\ndat')
    expect(first.events).toEqual([])

    const second = parseSseChunk(first.rest, 'a: {"delta":"hi"}\n\n')
    expect(second.events).toEqual([{ event: 'content', data: '{"delta":"hi"}' }])
    expect(second.rest).toBe('')
  })

  it('分片切在分隔空行中间（\\n | \\n）→ 待补齐后才产出事件', () => {
    const first = parseSseChunk('', 'event: e\ndata: x\n')
    expect(first.events).toEqual([])
    expect(first.rest).toBe('event: e\ndata: x\n')

    expect(parseSseChunk(first.rest, '\n').events).toEqual([{ event: 'e', data: 'x' }])
  })

  it('逐字符喂入也能还原出完整事件（最极端的分片）', () => {
    const payload = 'event: content\ndata: {"delta":"你好"}\n\n'
    let buffer = ''
    const events: Array<{ event: string; data: string }> = []
    for (const char of payload) {
      const step = parseSseChunk(buffer, char)
      events.push(...step.events)
      buffer = step.rest
    }
    expect(events).toEqual([{ event: 'content', data: '{"delta":"你好"}' }])
    expect(buffer).toBe('')
  })
})

describe('parseSseChunk - 忽略项', () => {
  it('纯注释块（心跳）不产出事件', () => {
    expect(parseSseChunk('', ': ping\n\n').events).toEqual([])
  })

  it('注释行与 data 混排时只取 data', () => {
    expect(parseSseChunk('', ': keep-alive\nevent: e\ndata: x\n\n').events).toEqual([
      { event: 'e', data: 'x' },
    ])
  })

  it('无 event 且无 data 的块不产出事件', () => {
    expect(parseSseChunk('', 'id: 42\n\n').events).toEqual([])
  })

  it('事件之间出现多余空行时不产出空事件（空块按规范忽略）', () => {
    const result = parseSseChunk('', 'event: a\ndata: 1\n\n\n\ndata: 2\n\n')
    expect(result.events).toEqual([
      { event: 'a', data: '1' },
      { event: 'message', data: '2' },
    ])
    expect(result.rest).toBe('')
  })

  it('空 chunk 不产出事件，rest 保持原样', () => {
    expect(parseSseChunk('', '')).toEqual({ events: [], rest: '' })
    expect(parseSseChunk('partial', '')).toEqual({ events: [], rest: 'partial' })
  })
})
