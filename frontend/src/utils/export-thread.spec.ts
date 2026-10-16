/**
 * 单元测试：会话导出 Markdown（2026-10-16）。
 *
 * 纯函数，直接断言文本。守住四件在导出稿里最容易"悄悄丢"的东西：
 * 结构（标题 / 元信息 / 分隔线）、角色标签（数字人名 vs 助手兜底）、
 * 引用与工具/失败轮这类**非正文信息**、文件名净化。
 */
import { describe, expect, it } from 'vitest'

import type { Conversation, Message } from '../api/types'
import { exportFilename, threadToMarkdown } from './export-thread'

const THREAD: Conversation = {
  thread_id: 'th_1234567890',
  agent_name: 'demo',
  title: '生产计划复核',
  created_at: '2026-10-16T01:00:00Z',
  updated_at: '2026-10-16T02:00:00Z',
}

const EXPORTED_AT = new Date('2026-10-16T03:00:00Z')

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm_1',
    role: 'user',
    content: '帮我看下计划',
    ts: '2026-10-16T01:30:00Z',
    feedback: null,
    ...overrides,
  }
}

describe('threadToMarkdown —— 结构与角色标签', () => {
  it('标题 + 元信息 + 逐条消息，消息之间用 --- 分隔，末尾有换行', () => {
    const markdown = threadToMarkdown(THREAD, [makeMessage()], EXPORTED_AT)

    expect(markdown).toContain('# 生产计划复核')
    expect(markdown).toContain('数字人：demo')
    expect(markdown).toContain('共 1 条消息')
    expect(markdown).toContain('## 我 ·')
    expect(markdown).toContain('帮我看下计划')
    expect(markdown).toContain('---')
    expect(markdown.endsWith('\n')).toBe(true)
  })

  it('标题为空 → 用「未命名会话」兜底（不出现空标题行）', () => {
    const markdown = threadToMarkdown({ ...THREAD, title: null }, [], EXPORTED_AT)

    expect(markdown).toContain('# 未命名会话')
    expect(markdown).not.toContain('# \n')
    expect(markdown).toContain('共 0 条消息')
  })

  it('assistant 用数字人名标注；缺省退回「助手」', () => {
    const named = threadToMarkdown(THREAD, [
      makeMessage({ role: 'assistant', agent_name: 'demo' }),
    ])
    expect(named).toContain('## demo ·')

    const anonymous = threadToMarkdown(THREAD, [makeMessage({ role: 'assistant' })])
    expect(anonymous).toContain('## 助手 ·')
  })
})

describe('threadToMarkdown —— 非正文信息不许丢', () => {
  it('引用文件 / 工具调用 / 失败轮都留在稿子里', () => {
    const markdown = threadToMarkdown(
      THREAD,
      [
        makeMessage({ attachments: [{ dir: '数据准备/生产计划', filename: 'plan.csv' }] }),
        makeMessage({
          id: 'm_2',
          role: 'assistant',
          content: '',
          status: 'failed',
          error: { code: 'LLM_UNAVAILABLE', message: 'upstream 503' },
          tool_calls: [
            {
              call_id: 'c1',
              name: 'ocr_image',
              status: 'success',
              started_at: '2026-10-16T01:31:00Z',
            },
          ],
        }),
      ],
      EXPORTED_AT,
    )

    expect(markdown).toContain('> 引用：@plan.csv')
    expect(markdown).toContain('> 工具：ocr_image（success）')
    expect(markdown).toContain('> 状态：本轮失败（LLM_UNAVAILABLE）')
  })

  it('已完成的轮次不写"失败"行（元信息只在确有其事时出现）', () => {
    const markdown = threadToMarkdown(
      THREAD,
      [makeMessage({ role: 'assistant', status: 'completed' })],
      EXPORTED_AT,
    )

    expect(markdown).not.toContain('> 状态：')
    expect(markdown).not.toContain('> 工具：')
    expect(markdown).not.toContain('> 引用：')
  })
})

describe('exportFilename —— 文件名净化', () => {
  it('标题里的路径/保留字符替换为 _', () => {
    expect(exportFilename({ ...THREAD, title: 'a/b:c*d?e"f<g>h|i' })).toBe('a_b_c_d_e_f_g_h_i.md')
  })

  it('标题为空 → 用会话 id 前 8 位兜底（不产生 ".md" 这种无名文件）', () => {
    expect(exportFilename({ ...THREAD, title: null })).toBe('会话-th_12345.md')
    expect(exportFilename({ ...THREAD, title: '   ' })).toBe('会话-th_12345.md')
  })
})
