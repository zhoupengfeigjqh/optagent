/**
 * 单元测试：只有附件时的默认话术（026，2026-11-18）
 *
 * 守住的语义：
 * 1. 只区分单复数——1 个「这个文件」，≥2 个「这些文件」；
 * 2. 措辞是「查看」而非「解析」（图片类附件 `read_file` 读不了，说"解析"会诱导失败调用）；
 * 3. 不带文件名（路径由服务端 `[引用文件]` 段承载）。
 */
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
