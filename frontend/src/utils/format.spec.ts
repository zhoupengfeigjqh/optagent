/**
 * 展示格式化单测（`src/utils/format.ts`）
 *
 * 运行方式：`npm run test` / `npm run test:coverage`（本地执行）
 *
 * 覆盖两条口径：
 * 1. **耗时统一 1 位小数**——后端 `duration_seconds` 精度最多 3 位（`Math.round(ms)/1000`），
 *    前端不依赖其精度（`contracts/backend-api.md` §7 差异 4）。
 * 2. **无数据返回空串**——调用方据此不渲染整块 UI，空串与 `"0"` 是两种不同语义，
 *    边界必须分开（如 `0 tokens` 要渲染、`null` 不渲染）。
 */
import { describe, expect, it } from 'vitest'

import { formatDuration, formatFileSize, formatTimestamp, formatTokens } from './format'

describe('formatTokens', () => {
  it('正常用量输出「输入 N · 输出 M tokens」', () => {
    expect(formatTokens({ input_tokens: 10, output_tokens: 5 })).toBe('输入 10 · 输出 5 tokens')
  })

  it('0 tokens 属"有数据"，照常渲染', () => {
    expect(formatTokens({ input_tokens: 0, output_tokens: 0 })).toBe('输入 0 · 输出 0 tokens')
  })

  it('null / undefined → 空串', () => {
    expect(formatTokens(null)).toBe('')
    expect(formatTokens(undefined)).toBe('')
  })

  it('字段非有限数 → 空串', () => {
    expect(formatTokens({ input_tokens: Number.NaN, output_tokens: 1 })).toBe('')
    expect(formatTokens({ input_tokens: 1, output_tokens: Number.POSITIVE_INFINITY })).toBe('')
  })
})

describe('formatDuration', () => {
  it('保留 1 位小数并追加 s', () => {
    expect(formatDuration(4.24)).toBe('4.2s')
    expect(formatDuration(4.26)).toBe('4.3s')
  })

  it('0 秒属"有数据"，输出 0.0s', () => {
    expect(formatDuration(0)).toBe('0.0s')
  })

  it('整数也补齐 1 位小数', () => {
    expect(formatDuration(12)).toBe('12.0s')
  })

  it('null / undefined / 非有限数 → 空串', () => {
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(undefined)).toBe('')
    expect(formatDuration(Number.NaN)).toBe('')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('')
  })
})

describe('formatFileSize', () => {
  it('小于 1KB 用 B，且不带小数', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1023)).toBe('1023 B')
  })

  it('1KB（含）至 1MB（不含）用 KB，保留 1 位小数', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1024.0 KB')
  })

  it('1MB 及以上用 MB，保留 1 位小数', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('负数 / 非有限数 / 空值 → 空串', () => {
    expect(formatFileSize(-1)).toBe('')
    expect(formatFileSize(Number.NaN)).toBe('')
    expect(formatFileSize(null)).toBe('')
    expect(formatFileSize(undefined)).toBe('')
  })
})

describe('formatTimestamp', () => {
  it('输出本地时间 YYYY-MM-DD HH:mm', () => {
    // 用本地时间构造再转 ISO，使断言不依赖运行环境时区
    expect(formatTimestamp(new Date(2026, 8, 15, 9, 5).toISOString())).toBe('2026-09-15 09:05')
  })

  it('月 / 日 / 时 / 分补零，年份补到 4 位', () => {
    expect(formatTimestamp(new Date(2026, 0, 2, 3, 4).toISOString())).toBe('2026-01-02 03:04')
  })

  it('空字符串 / 空值 → 空串', () => {
    expect(formatTimestamp('')).toBe('')
    expect(formatTimestamp(null)).toBe('')
    expect(formatTimestamp(undefined)).toBe('')
  })

  it('非法时间串 → 空串（不抛异常）', () => {
    expect(formatTimestamp('not-a-date')).toBe('')
  })
})
