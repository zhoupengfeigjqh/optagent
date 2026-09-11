import { describe, expect, it } from 'vitest'

import { formatDuration, formatFileSize, formatTimestamp, formatTokens } from './format'

describe('formatTokens', () => {
  it('按契约文案格式化输入/输出 token', () => {
    expect(formatTokens({ input_tokens: 10, output_tokens: 5 })).toBe('输入 10 · 输出 5 tokens')
  })

  it('0 值照常展示', () => {
    expect(formatTokens({ input_tokens: 0, output_tokens: 0 })).toBe('输入 0 · 输出 0 tokens')
  })

  it('缺失或非法值返回空串（调用方据此不渲染）', () => {
    expect(formatTokens(null)).toBe('')
    expect(formatTokens(undefined)).toBe('')
    expect(formatTokens({ input_tokens: Number.NaN, output_tokens: 1 })).toBe('')
  })
})

describe('formatDuration（统一 1 位小数，§7 差异 4）', () => {
  it('保留 1 位小数并追加 s', () => {
    expect(formatDuration(4.2)).toBe('4.2s')
    expect(formatDuration(0)).toBe('0.0s')
    expect(formatDuration(12)).toBe('12.0s')
  })

  it('后端精度不固定（最多 3 位小数）时统一收敛为 1 位', () => {
    expect(formatDuration(4.218)).toBe('4.2s')
    expect(formatDuration(4.256)).toBe('4.3s')
    expect(formatDuration(0.999)).toBe('1.0s')
  })

  it('缺失或非法值返回空串', () => {
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(undefined)).toBe('')
    expect(formatDuration(Number.NaN)).toBe('')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('')
  })
})

describe('formatFileSize', () => {
  it('小于 1KB 展示 B', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(1023)).toBe('1023 B')
  })

  it('KB 与 MB 保留 1 位小数', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(50 * 1024 * 1024)).toBe('50.0 MB')
  })

  it('非法值返回空串', () => {
    expect(formatFileSize(null)).toBe('')
    expect(formatFileSize(-1)).toBe('')
    expect(formatFileSize(Number.NaN)).toBe('')
  })
})

describe('formatTimestamp', () => {
  it('按本地时间格式化为 YYYY-MM-DD HH:mm', () => {
    const local = new Date(2026, 8, 10, 9, 5, 30)

    expect(formatTimestamp(local.toISOString())).toBe('2026-09-10 09:05')
  })

  it('月/日/时/分补零', () => {
    const local = new Date(2026, 0, 3, 7, 8)

    expect(formatTimestamp(local.toISOString())).toBe('2026-01-03 07:08')
  })

  it('非法输入返回空串', () => {
    expect(formatTimestamp('')).toBe('')
    expect(formatTimestamp(null)).toBe('')
    expect(formatTimestamp('not-a-date')).toBe('')
  })
})
