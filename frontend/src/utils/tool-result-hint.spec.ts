/**
 * 单元测试：工具卡片的截断说明（2026-11-07，2026-11-08 随"不再拉全文"简化）
 *
 * 这是"该说哪一句"的**唯一判据**（组件只负责渲染），因此三种情形逐一穷举：
 * 未截断 → 不提示；内置工具（无副本）→ 未保存；外部来源（有副本）→ 只显示前一部分。
 */
import { describe, expect, it } from 'vitest'

import type { ToolCallItem } from './tool-calls'
import { NO_HINT, resultHint } from './tool-result-hint'

function item(partial: Partial<ToolCallItem> = {}): ToolCallItem {
  return { callId: 'c1', name: 'read_file', status: 'success', ...partial }
}

describe('resultHint', () => {
  it('未截断：不提示（正文就是全文）', () => {
    expect(resultHint(item({ content: '全文' }))).toBe(NO_HINT)
  })

  it('内置工具超阈值（无 artifact_size）：明说完整内容未保存，并给出补救方式', () => {
    expect(resultHint(item({ content: '前半部分', truncated: true }))).toBe(
      '结果过大，仅保留了前一部分（完整内容未保存，可让助手重新读取）',
    )
  })

  it('外部来源超阈值（有 artifact_size）：说明只显示前一部分、副本体积与位置', () => {
    expect(
      resultHint(
        item({
          name: 'mcp_sql_query',
          content: '前半部分',
          truncated: true,
          artifactSize: 1843200,
        }),
      ),
    ).toBe('结果过大，仅显示前一部分（完整正文 1.8 MB 存于临时空间，可让助手读取）')
  })

  it('两者的差别只落在"有没有副本"：内置说未保存，外部说在临时空间', () => {
    expect(resultHint(item({ truncated: true }))).toContain('未保存')
    expect(resultHint(item({ truncated: true, artifactSize: 1024 }))).toContain('存于临时空间')
  })

  it('无提示的哨兵值为空串', () => {
    expect(NO_HINT).toBe('')
  })
})
