/**
 * 展示格式化单测（`src/utils/format.ts`）
 *
 * 运行方式：`npm run test` / `npm run test:coverage`（本地执行）
 *
 * 覆盖三条口径：
 * 1. **耗时统一 1 位小数**——后端 `duration_seconds` 精度最多 3 位（`Math.round(ms)/1000`），
 *    前端不依赖其精度（`contracts/backend-api.md` §7 差异 4）。
 * 2. **无数据返回空串/占位**——调用方据此不渲染整块 UI，空串与 `"0"` 是两种不同语义，
 *    边界必须分开（如 `0 tokens` 要渲染、`null` 不渲染）。
 * 3. **单位各自有测试**——`Sec` / `Ms` / `Minutes` 三种入参此前共用一个名字，
 *    正是本次收敛要防的事故，故每个函数单独断言其单位换算。
 */
import { describe, expect, it } from 'vitest'

import {
  formatBytes,
  formatDurationMs,
  formatDurationSec,
  formatMinutesCompact,
  formatTimestamp,
  formatTokens,
} from './format'

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

describe('formatDurationSec', () => {
  it('保留 1 位小数并追加 s', () => {
    expect(formatDurationSec(4.24)).toBe('4.2s')
    expect(formatDurationSec(4.26)).toBe('4.3s')
  })

  it('0 秒属"有数据"，输出 0.0s', () => {
    expect(formatDurationSec(0)).toBe('0.0s')
  })

  it('整数也补齐 1 位小数', () => {
    expect(formatDurationSec(12)).toBe('12.0s')
  })

  it('null / undefined / 非有限数 → 空串', () => {
    expect(formatDurationSec(null)).toBe('')
    expect(formatDurationSec(undefined)).toBe('')
    expect(formatDurationSec(Number.NaN)).toBe('')
    expect(formatDurationSec(Number.POSITIVE_INFINITY)).toBe('')
  })
})

describe('formatDurationMs', () => {
  it('不足 1 秒按毫秒取整', () => {
    expect(formatDurationMs(84)).toBe('84ms')
    expect(formatDurationMs(0)).toBe('0ms')
    // 取整后已到 1000ms，换秒而不是输出 `1000ms`
    expect(formatDurationMs(999.6)).toBe('1.0s')
  })

  it('1 秒及以上换成秒并保留 1 位小数', () => {
    expect(formatDurationMs(1000)).toBe('1.0s')
    expect(formatDurationMs(1620)).toBe('1.6s')
  })

  it('负数 / 非有限数 / 空值 → 空串', () => {
    expect(formatDurationMs(-1)).toBe('')
    expect(formatDurationMs(Number.NaN)).toBe('')
    expect(formatDurationMs(null)).toBe('')
    expect(formatDurationMs(undefined)).toBe('')
  })
})

describe('formatMinutesCompact', () => {
  it('不足 1 小时只给分钟', () => {
    expect(formatMinutesCompact(45)).toBe('45min')
  })

  it('整小时省掉分钟段', () => {
    expect(formatMinutesCompact(120)).toBe('2h')
  })

  it('小时 + 分钟', () => {
    expect(formatMinutesCompact(135)).toBe('2h15min')
  })

  it('余数四舍五入到 60 时进位，不出现 1h60min', () => {
    expect(formatMinutesCompact(119.6)).toBe('2h')
    expect(formatMinutesCompact(59.6)).toBe('1h')
  })

  it('非正数 / 非有限数 / 空值 → 默认占位 --（指标卡不留白）', () => {
    expect(formatMinutesCompact(0)).toBe('--')
    expect(formatMinutesCompact(-5)).toBe('--')
    expect(formatMinutesCompact(Number.NaN)).toBe('--')
    expect(formatMinutesCompact(null)).toBe('--')
    expect(formatMinutesCompact(undefined)).toBe('--')
  })

  it('载荷里的数字字符串照常换算（排产指标是 string | number）', () => {
    expect(formatMinutesCompact('135')).toBe('2h15min')
    expect(formatMinutesCompact('')).toBe('--')
    expect(formatMinutesCompact('abc')).toBe('--')
  })

  it('占位可自定义', () => {
    expect(formatMinutesCompact(Number.NaN, '')).toBe('')
  })
})

describe('formatBytes', () => {
  it('小于 1KB 用 B，且不带小数', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('1KB（含）至 1MB（不含）用 KB，保留 1 位小数', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB')
  })

  it('1MB 及以上用 MB，保留 1 位小数', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('负数 / 非有限数 / 空值 → 默认空串（文件列表整段不渲染）', () => {
    expect(formatBytes(-1)).toBe('')
    expect(formatBytes(Number.NaN)).toBe('')
    expect(formatBytes(null)).toBe('')
    expect(formatBytes(undefined)).toBe('')
  })

  it('占位可自定义（铃铛面板用 — 而不是留白）', () => {
    expect(formatBytes(Number.NaN, '—')).toBe('—')
    expect(formatBytes(-1, '—')).toBe('—')
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

  it('withSeconds 追加秒（铃铛面板要精确到秒）', () => {
    expect(
      formatTimestamp(new Date(2026, 8, 15, 9, 5, 3).toISOString(), { withSeconds: true }),
    ).toBe('2026-09-15 09:05:03')
  })

  it('空字符串 / 空值 / 非法时间串 → 默认空串（不抛异常）', () => {
    expect(formatTimestamp('')).toBe('')
    expect(formatTimestamp(null)).toBe('')
    expect(formatTimestamp(undefined)).toBe('')
    expect(formatTimestamp('not-a-date')).toBe('')
  })

  it('占位可自定义（铃铛面板可读占位，不留白）', () => {
    expect(formatTimestamp('not-a-date', { fallback: '时间未知' })).toBe('时间未知')
    expect(formatTimestamp('', { fallback: '时间未知' })).toBe('时间未知')
  })
})
