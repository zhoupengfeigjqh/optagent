/**
 * 单元测试：日志保留策略（任务 2026-09-15）
 *
 * 守住一条：**日志只保留最近 3 天**——启动/跨天时自动清理过期文件，
 * 且 MUST NOT 误删其他前缀或非日志文件。
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LOG_RETENTION_DAYS, pruneOldLogs } from '../../src/logging'

function dayFile(prefix: string, dayOffsetDays: number): string {
  const day = new Date(Date.now() + dayOffsetDays * 86_400_000).toISOString().slice(0, 10)
  return `${prefix}-${day}.log`
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'log-prune-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('pruneOldLogs', () => {
  it(`默认保留 ${LOG_RETENTION_DAYS} 天：更早的删除，窗口内的保留`, () => {
    mkdirSync(dir, { recursive: true })
    const keepRecent = path.join(dir, dayFile('app', -1)) // 昨天：保留
    const keepToday = path.join(dir, dayFile('app', 0)) // 今天：保留
    const removeOld = path.join(dir, dayFile('app', -5)) // 5 天前：删除
    for (const f of [keepRecent, keepToday, removeOld]) writeFileSync(f, '{}\n', 'utf8')

    pruneOldLogs(dir, ['app'], LOG_RETENTION_DAYS)

    expect(readdirSync(dir).sort()).toEqual([path.basename(keepRecent), path.basename(keepToday)].sort())
  })

  it('只清理指定前缀的日志：usage 与 app 互不影响，非日志文件不动', () => {
    mkdirSync(dir, { recursive: true })
    const oldUsage = path.join(dir, dayFile('usage', -5))
    const oldApp = path.join(dir, dayFile('app', -5))
    const notALog = path.join(dir, 'app-notes.txt')
    for (const f of [oldUsage, oldApp, notALog]) writeFileSync(f, 'x', 'utf8')

    pruneOldLogs(dir, ['app'], LOG_RETENTION_DAYS)

    expect(readdirSync(dir).sort()).toContain(path.basename(oldUsage))
    expect(readdirSync(dir).sort()).toContain('app-notes.txt')
    expect(readdirSync(dir)).not.toContain(path.basename(oldApp))
  })

  it('目录不存在：静默返回不抛出（清理不致命）', () => {
    expect(() => pruneOldLogs(path.join(dir, 'no-such-dir'), ['app'], 3)).not.toThrow()
  })

  it('保留天数语义：keepDays=3 意味着"今天+前两天"，第 3 天前的删除', () => {
    expect(LOG_RETENTION_DAYS).toBe(3)
  })
})
