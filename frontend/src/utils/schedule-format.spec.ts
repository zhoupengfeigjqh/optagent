/**
 * 单元测试：定时任务展示格式化（015）
 *
 * 全是纯函数，断言文案本身——这批文案同时出现在任务表格、运行记录弹窗与状态圆点旁，
 * 改动一处就会牵动三处，必须有唯一真源可断言。
 */
import { describe, expect, it } from 'vitest'
import {
  formatCount,
  formatDateTime,
  formatInterval,
  formatNextRun,
  formatRebuilt,
  formatRunReason,
  formatRunResult,
  formatTaskStatus,
} from './schedule-format'

describe('formatDateTime', () => {
  it('秒级本地时间，与 `formatTimestamp` 同源', () => {
    const iso = '2026-10-30T01:02:03.000Z'
    const date = new Date(iso)
    const pad = (value: number, width = 2): string => String(value).padStart(width, '0')

    expect(formatDateTime(iso)).toBe(
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    )
  })

  it('空值与非法值 → 占位符（表格不留白）', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime(undefined)).toBe('—')
    expect(formatDateTime('不是时间')).toBe('—')
  })
})

describe('formatInterval', () => {
  it('取最大整除单位', () => {
    expect(formatInterval(60)).toBe('每 1 分钟')
    expect(formatInterval(300)).toBe('每 5 分钟')
    expect(formatInterval(3_600)).toBe('每 1 小时')
    expect(formatInterval(86_400)).toBe('每 1 天')
  })

  it('不能整除时退回秒（不编造小数单位）', () => {
    expect(formatInterval(90)).toBe('每 90 秒')
    expect(formatInterval(45)).toBe('每 45 秒')
  })

  it('非法值 → 占位符', () => {
    expect(formatInterval(0)).toBe('—')
    expect(formatInterval(-5)).toBe('—')
    expect(formatInterval(Number.NaN)).toBe('—')
  })
})

describe('formatCount', () => {
  it('已执行 X / Y 次', () => {
    expect(formatCount(0, 5)).toBe('已执行 0 / 5 次')
    expect(formatCount(2, 3)).toBe('已执行 2 / 3 次')
  })

  it('负数按 0 处理（存储被外部改坏时也不出现 -1）', () => {
    expect(formatCount(-1, 3)).toBe('已执行 0 / 3 次')
  })
})

describe('formatRunResult / formatRunReason', () => {
  it('三种结果', () => {
    expect(formatRunResult('success')).toBe('成功')
    expect(formatRunResult('failed')).toBe('失败')
    expect(formatRunResult('skipped')).toBe('已跳过')
  })

  it('四种原因 + 无原因', () => {
    expect(formatRunReason('previous_run_active')).toBe('上一轮尚未结束')
    expect(formatRunReason('busy_limit')).toBe('并发额度已满')
    expect(formatRunReason('agent_unavailable')).toBe('数字人不可用')
    expect(formatRunReason('run_failed')).toBe('执行失败')
    expect(formatRunReason(null)).toBe('')
  })
})

describe('formatRebuilt', () => {
  it('重建才有标注（否则空串，不占位）', () => {
    expect(formatRebuilt(true)).toBe('重建会话')
    expect(formatRebuilt(false)).toBe('')
  })
})

describe('formatTaskStatus', () => {
  it('系统停用原因优先于其余状态', () => {
    expect(
      formatTaskStatus({ status: 'idle', terminated: true, disabled_reason: 'agent_unavailable' }),
    ).toBe('数字人不可用（已停用）')
  })

  it('已结束优先于执行中（次数用尽时 enabled 仍为 true）', () => {
    expect(formatTaskStatus({ status: 'running', terminated: true, disabled_reason: null })).toBe(
      '已结束',
    )
  })

  it('正常两态', () => {
    expect(formatTaskStatus({ status: 'running', terminated: false, disabled_reason: null })).toBe(
      '执行中',
    )
    expect(formatTaskStatus({ status: 'idle', terminated: false, disabled_reason: null })).toBe(
      '未开始',
    )
  })
})

describe('formatNextRun', () => {
  it('有值加前缀，无值占位', () => {
    expect(formatNextRun({ next_run_at: '2026-10-31T01:00:00.000Z' })).toMatch(/^下次 \d{4}-/)
    expect(formatNextRun({ next_run_at: null })).toBe('—')
  })
})
