import { describe, expect, it } from 'vitest'

import {
  ATTACHMENT_ONLY_MULTI,
  ATTACHMENT_ONLY_SINGLE,
  attachmentOnlyPrompt,
} from './attachment-only-prompt'

describe('attachmentOnlyPrompt —— 正文为空的默认话术', () => {
  it('1 个附件 → 「请查看这个文件」', () => {
    expect(attachmentOnlyPrompt(1)).toBe('请查看这个文件')
  })

  it('≥2 个附件 → 「请查看这些文件」', () => {
    expect(attachmentOnlyPrompt(2)).toBe('请查看这些文件')
    expect(attachmentOnlyPrompt(5)).toBe('请查看这些文件')
  })

  it('措辞常量：动词是「查看」，且不含空格（正文会被 trim 后提交）', () => {
    expect(ATTACHMENT_ONLY_SINGLE).toBe('请查看这个文件')
    expect(ATTACHMENT_ONLY_MULTI).toBe('请查看这些文件')
    expect(ATTACHMENT_ONLY_SINGLE.trim()).toBe(ATTACHMENT_ONLY_SINGLE)
    expect(ATTACHMENT_ONLY_MULTI.trim()).toBe(ATTACHMENT_ONLY_MULTI)
  })

  it('不带文件名：话术里没有路径分隔符', () => {
    for (const count of [1, 2]) {
      expect(attachmentOnlyPrompt(count)).not.toContain('/')
      expect(attachmentOnlyPrompt(count)).not.toContain('.csv')
    }
  })
})
