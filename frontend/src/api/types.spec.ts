import { describe, expect, it } from 'vitest'

// 以 `?raw` 方式读取源码文本（Vite 提供类型），对契约做静态断言
import typesSource from './types.ts?raw'

/**
 * 契约类型文件的**架构约束测试**。
 *
 * TS 接口在运行时被擦除，无法用运行时断言校验其字段集合，
 * 因此这里直接对源码文本做静态断言——这是 V-04 唯一可自动化的落点。
 */

/** 提取指定接口/类型别名的源码块（自声明行起至首个顶层 `}`）。 */
function extractBlock(source: string, name: string): string {
  const startMatch = new RegExp(`export (?:interface|type) ${name}\\b`).exec(source)
  if (!startMatch) {
    throw new Error(`未找到契约类型：${name}`)
  }
  const start = startMatch.index
  const end = source.indexOf('\n}', start)
  return end === -1 ? source.slice(start) : source.slice(start, end + 2)
}

describe('Message 契约（V-04：思考与工具调用字段 0 落历史）', () => {
  const messageBlock = extractBlock(typesSource, 'Message')

  it('不包含思考内容字段', () => {
    expect(messageBlock).not.toMatch(/\bthinking\b/)
    expect(messageBlock).not.toMatch(/\breasoning\b/)
  })

  it('不包含工具调用字段', () => {
    expect(messageBlock).not.toMatch(/\btool_call/)
    expect(messageBlock).not.toMatch(/\btoolCalls\b/)
    expect(messageBlock).not.toMatch(/\btools\b/)
  })

  it('包含契约要求的全部字段', () => {
    for (const field of [
      'id',
      'role',
      'content',
      'ts',
      'status',
      'usage',
      'duration_seconds',
      'attachments',
      'feedback',
      'error',
    ]) {
      expect(messageBlock).toMatch(new RegExp(`\\b${field}\\??:`))
    }
  })

  it('feedback 为恒返回字段（非可选）', () => {
    expect(messageBlock).toMatch(/\bfeedback:/)
    expect(messageBlock).not.toMatch(/\bfeedback\?:/)
  })
})

describe('请求/响应契约字段名与后端一致', () => {
  it('发消息请求体为 content / thinking / model / attachments', () => {
    const block = extractBlock(typesSource, 'SendMessageRequest')
    for (const field of ['content', 'thinking', 'model', 'attachments']) {
      expect(block).toMatch(new RegExp(`\\b${field}\\??:`))
    }
  })

  it('文件引用为结构化的 {dir, filename}', () => {
    const block = extractBlock(typesSource, 'FileReference')
    expect(block).toMatch(/\bdir:/)
    expect(block).toMatch(/\bfilename:/)
  })

  it('SSE 事件名常量覆盖 6 类事件', async () => {
    const { SSE_EVENT } = await import('../constants/events')
    expect(Object.values(SSE_EVENT)).toEqual([
      'thinking',
      'content',
      'tool_call',
      'tool_call_end',
      'done',
      'error',
    ])
  })
})
