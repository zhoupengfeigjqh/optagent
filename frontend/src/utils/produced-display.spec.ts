/**
 * 单元测试：后台产出展示格式化（纯函数）
 *
 * 重点是**与后端口径一致**：同一条产出在「提示词清单」与「铃铛面板」里
 * 必须给出同样的人类可读描述，否则同一个东西在两处说法不一。
 */
import { describe, expect, it } from 'vitest'
import {
  badgeText,
  formatBytes,
  formatDateTime,
  middleEllipsis,
  producedSummary,
  producedTag,
  producedTagFull,
  relativeTime,
  splitProducedPath,
} from './produced-display'

const NOW = Date.parse('2026-09-25T12:00:00.000Z')

describe('relativeTime', () => {
  it('按后端同档位分档：刚刚 / 分钟 / 小时 / 天', () => {
    expect(relativeTime('2026-09-25T11:59:30.000Z', NOW)).toBe('刚刚')
    expect(relativeTime('2026-09-25T11:30:00.000Z', NOW)).toBe('30 分钟前')
    expect(relativeTime('2026-09-25T09:00:00.000Z', NOW)).toBe('3 小时前')
    expect(relativeTime('2026-09-23T12:00:00.000Z', NOW)).toBe('2 天前')
  })

  it('无法解析的时间给可读占位，不留空白', () => {
    expect(relativeTime('not-a-time', NOW)).toBe('时间未知')
  })

  it('未来时刻不出现负数（按"刚刚"处理）', () => {
    expect(relativeTime('2026-09-25T12:05:00.000Z', NOW)).toBe('刚刚')
  })
})

describe('formatDateTime', () => {
  it('按本地时区格式化为 YYYY-MM-DD HH:mm:ss，月/日/时/分/秒补零', () => {
    // 先构造本地时刻再转 ISO，保证断言不随运行机器时区变化
    const iso = new Date(2026, 8, 25, 9, 5, 3).toISOString()
    expect(formatDateTime(iso)).toBe('2026-09-25 09:05:03')
  })

  it('无法解析的时间给可读占位，不留空白', () => {
    expect(formatDateTime('not-a-time')).toBe('时间未知')
  })
})

describe('formatBytes', () => {
  it('B / KB / MB 三档，与后端一致（KB/MB 保留一位小数）', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('非法输入给占位而不是 NaN', () => {
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
  })
})

describe('splitProducedPath', () => {
  it('拆出预览接口要的 dir + filename', () => {
    expect(splitProducedPath('临时空间/后台产出/th_1_j_2.txt')).toEqual({
      dir: '临时空间/后台产出',
      filename: 'th_1_j_2.txt',
    })
  })

  it('无分隔符时 dir 为空串——刻意不猜，让接口按自己的口径报错', () => {
    expect(splitProducedPath('x.txt')).toEqual({ dir: '', filename: 'x.txt' })
  })

  it('只按最后一个分隔符拆（目录本身可以带层级）', () => {
    expect(splitProducedPath('a/b/c.txt')).toEqual({ dir: 'a/b', filename: 'c.txt' })
  })
})

describe('badgeText', () => {
  it('超过 99 显示 99+，避免角标被长数字撑破', () => {
    expect(badgeText(1)).toBe('1')
    expect(badgeText(99)).toBe('99')
    expect(badgeText(100)).toBe('99+')
  })
})

describe('middleEllipsis', () => {
  it('够短就原样返回（不无谓地加省略号）', () => {
    expect(middleEllipsis('job_1')).toBe('job_1')
    expect(middleEllipsis('a'.repeat(17))).toBe('a'.repeat(17)) // head+tail+1 = 17
  })

  it('过长收中段，两端保留——尾部不会再被 CSS 省略号吃掉', () => {
    expect(middleEllipsis('ocr_1790123456789_8bcccfd2')).toBe('ocr_17901234…cfd2')
  })

  it('按码点切，不切开代理对（emoji 不会碎成半个）', () => {
    const out = middleEllipsis('😀'.repeat(20), 2, 2)
    expect(out).toBe('😀😀…😀😀')
    expect(Array.from(out)).toHaveLength(5)
  })
})

describe('producedSummary', () => {
  it('有摘要用摘要（去首尾空白）', () => {
    expect(producedSummary('  识别到 47 行文字  ')).toBe('识别到 47 行文字')
  })

  it('缺省 / 空串 / 全空白 → 可读兜底，MUST NOT 回落成机读文件名', () => {
    const fallback = '后台任务结果（该任务未提供摘要）'
    expect(producedSummary(undefined)).toBe(fallback)
    expect(producedSummary('')).toBe(fallback)
    expect(producedSummary('   ')).toBe(fallback)
    expect(fallback).not.toContain('th_1_')
  })
})

describe('producedTag', () => {
  it('`工具名 · job_id`；短值不做任何截断', () => {
    expect(producedTag('ocr__ocr_image', 'job_1')).toBe('ocr__ocr_image · job_1')
  })

  it('工具名与 job_id 各自中间省略：两端可辨、宽度有界', () => {
    const out = producedTag('a'.repeat(40), 'ocr_1790123456789_8bcccfd2')
    expect(out).toBe(`${'a'.repeat(24)}…${'a'.repeat(8)} · ocr_17901234…cfd2`)
  })

  it('工具名缺省 → 可读兜底（与元信息行同口径），不留白', () => {
    expect(producedTag('', 'job_1')).toBe('未知工具 · job_1')
    expect(producedTag('   ', 'job_1')).toBe('未知工具 · job_1')
  })
})

describe('producedTagFull', () => {
  it('悬停提示给完整值：截断只影响屏幕，不该让人拿不到原文', () => {
    const longId = 'ocr_1790123456789_8bcccfd2'
    expect(producedTagFull('a'.repeat(40), longId)).toBe(`${'a'.repeat(40)} · ${longId}`)
    expect(producedTagFull('', 'job_1')).toBe('未知工具 · job_1')
  })
})
