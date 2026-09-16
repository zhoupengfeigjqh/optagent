/**
 * 单元测试：用量库的日志模式回退（R4 / T098 的健壮性补强）
 *
 * 守住一条：**不支持 WAL 的文件系统上服务仍能启动**。
 *
 * 背景（实测缺陷，`quickstart.md` §10.3）：WAL 需要 `mmap` 一个 `-shm` 共享内存
 * 文件，部分文件系统不支持（Windows + Docker Desktop 的绑定挂载即如此），
 * 此时 pragma 抛 `SQLITE_IOERR_SHMOPEN`。该调用位于 `UsageDb` 构造里，
 * 不兜住就会让**整个服务起不来**（容器无限重启）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  UsageDb,
  applyJournalModeSafely,
  describeShmOpenFailure,
  isShmOpenFailure,
} from '../../src/infra/usage-db'

describe('applyJournalModeSafely', () => {
  it('正常文件系统：选定 WAL，且不触发回退', () => {
    const pragma = vi.fn()
    const onFallback = vi.fn()

    expect(applyJournalModeSafely(pragma, onFallback)).toBe('WAL')
    expect(pragma).toHaveBeenCalledTimes(1)
    expect(pragma).toHaveBeenCalledWith('WAL')
    expect(onFallback).not.toHaveBeenCalled()
  })

  it('不支持共享内存（SQLITE_IOERR_SHMOPEN）：回退 DELETE，并把原因交给调用方记录', () => {
    const pragma = vi.fn((mode: string) => {
      if (mode === 'WAL') {
        const err = new Error('disk I/O error') as NodeJS.ErrnoException
        err.code = 'SQLITE_IOERR_SHMOPEN'
        throw err
      }
      return undefined
    })
    const onFallback = vi.fn()

    expect(applyJournalModeSafely(pragma, onFallback)).toBe('DELETE')
    expect(onFallback).toHaveBeenCalledWith('SQLITE_IOERR_SHMOPEN')
    expect(pragma).toHaveBeenLastCalledWith('DELETE')
  })

  it('异常缺少 code 时也能回退（不误报为 UNKNOWN 而放弃）', () => {
    const pragma = vi.fn((mode: string) => {
      if (mode === 'WAL') throw new Error('no code here')
      return undefined
    })
    const onFallback = vi.fn()

    expect(applyJournalModeSafely(pragma, onFallback)).toBe('DELETE')
    expect(onFallback).toHaveBeenCalledWith('UNKNOWN')
  })

  it('连 DELETE 都设置不了：不抛出，返回 default（读写仍可用）', () => {
    const pragma = vi.fn(() => {
      throw new Error('always fails')
    })

    expect(applyJournalModeSafely(pragma, vi.fn())).toBe('default')
  })

  it('回退不是"跳过校验"：DELETE 分支确实被调用过', () => {
    const calls: string[] = []
    const pragma = vi.fn((mode: string) => {
      calls.push(mode)
      if (mode === 'WAL') throw Object.assign(new Error('x'), { code: 'SQLITE_IOERR_SHMOPEN' })
    })

    applyJournalModeSafely(pragma, vi.fn())
    expect(calls).toEqual(['WAL', 'DELETE'])
  })
})

describe('SHMOPEN 失败的可操作性（把无法理解的报错翻译成处置步骤）', () => {
  it('isShmOpenFailure 只认 SHMOPEN（不误吞其他 IO 错误，避免掩盖真故障）', () => {
    expect(isShmOpenFailure(Object.assign(new Error('x'), { code: 'SQLITE_IOERR_SHMOPEN' }))).toBe(true)
    expect(isShmOpenFailure(Object.assign(new Error('x'), { code: 'SQLITE_CORRUPT' }))).toBe(false)
    expect(isShmOpenFailure(new Error('x'))).toBe(false)
    expect(isShmOpenFailure(undefined)).toBe(false)
  })

  it('说明里给出库路径、原始码、以及两条可操作处置（陈旧 -shm / 不支持共享内存）', () => {
    const text = describeShmOpenFailure('/app/.opt-agent/usage.db', 'SQLITE_IOERR_SHMOPEN')
    expect(text).toContain('/app/.opt-agent/usage.db')
    expect(text).toContain('SQLITE_IOERR_SHMOPEN')
    expect(text).toContain('-shm')
    expect(text).toContain('容器卷')
    // 明确告知数据未损坏，避免运维直接删库
    expect(text).toContain('数据本身未损坏')
  })

  it('缺 code 时也能给出同样可操作的说明', () => {
    expect(describeShmOpenFailure('/x/usage.db', undefined)).toContain('SQLITE_IOERR_SHMOPEN')
  })
})

describe('UsageDb —— 真实打开路径仍然可用', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'usage-db-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('可创建、写入用量、读取汇总（R4 的回退不影响既有功能）', () => {
    const db = new UsageDb(path.join(dir, 'usage.db'))
    try {
      db.record({
        userId: 'admin',
        threadId: 't1',
        agentName: 'demo',
        inputTokens: 10,
        outputTokens: 5,
        createdAt: '2026-09-15T00:00:00.000Z',
      })
      expect(db.summary({ userId: 'admin', agentName: 'demo' }).total.outputTokens).toBe(5)
    } finally {
      db.close()
    }
  })

  it('可记录 MCP 调用并读回统计：累计 + 四个时间窗（任务 2026-09-15）', () => {
    const db = new UsageDb(path.join(dir, 'usage.db'))
    try {
      db.recordMcpCall('ocr', true)
      db.recordMcpCall('ocr', false)
      const stats = db.mcpCallStats()
      expect(stats).toHaveLength(1)
      const item = stats[0]!
      // 累计口径不变
      expect(item.name).toBe('ocr')
      expect(item.calls_total).toBe(2)
      expect(item.calls_ok).toBe(1)
      expect(item.calls_failed).toBe(1)
      // 刚记录的调用落在所有时间窗内：各窗 total=2 / ok=1 / failed=1
      for (const key of ['h24', 'd7', 'd30', 'd365'] as const) {
        expect(item.windows[key]).toEqual({ ok: 1, failed: 1, total: 2 })
      }
    } finally {
      db.close()
    }
  })

  it('无事件的服务时间窗为 0（而不是缺失字段）', () => {
    const db = new UsageDb(path.join(dir, 'usage.db'))
    try {
      db.recordMcpCall('ocr', true)
      const stats = db.mcpCallStats()
      expect(stats[0]?.windows.h24).toEqual({ ok: 1, failed: 0, total: 1 })
    } finally {
      db.close()
    }
  })

  it('未出现过的服务不返回（由平台侧以 0 呈现）', () => {
    const db = new UsageDb(path.join(dir, 'usage.db'))
    try {
      expect(db.mcpCallStats()).toEqual([])
    } finally {
      db.close()
    }
  })

  it('按用户明细：成功/失败分列聚合（2026-09-16 十四次调整）', () => {
    const db = new UsageDb(path.join(dir, 'usage.db'))
    try {
      db.recordMcpCall('ocr', true, 'admin')
      db.recordMcpCall('ocr', false, 'admin')
      db.recordMcpCall('ocr', true, 'zpf')
      const [item] = db.mcpCallStats()
      expect(item!.calls_total).toBe(3)
      const byUser = new Map(item!.users.map((user) => [user.user_id, user]))
      expect(byUser.get('admin')).toMatchObject({ calls_ok: 1, calls_failed: 1, calls_total: 2 })
      expect(byUser.get('admin')!.last_called_at).not.toBeNull()
      expect(byUser.get('zpf')).toMatchObject({ calls_ok: 1, calls_failed: 0, calls_total: 1 })
    } finally {
      db.close()
    }
  })

  it('旧库迁移：无 user_id 列的事件表打开即补列，老行归入"未归属"（不丢历史）', () => {
    const dbPath = path.join(dir, 'usage.db')
    // 手工建一个"十四次调整之前"的老-schema 库（事件表没有 user_id 列）
    const legacy = new Database(dbPath)
    legacy.exec(`CREATE TABLE mcp_call_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_name TEXT NOT NULL,
      ok INTEGER NOT NULL,
      called_at TEXT NOT NULL
    )`)
    legacy
      .prepare(`INSERT INTO mcp_call_events (service_name, ok, called_at) VALUES (?, ?, ?)`)
      .run('ocr', 1, '2026-09-15T00:00:00.000Z')
    legacy.close()

    const db = new UsageDb(dbPath)
    try {
      db.recordMcpCall('ocr', true, 'admin')
      const [item] = db.mcpCallStats()
      // 老行（user_id 补列后为 NULL）与新行各自归组，两边都不丢
      const byUser = new Map(item!.users.map((user) => [user.user_id, user]))
      expect(byUser.get(null)).toMatchObject({ calls_ok: 1, calls_total: 1 })
      expect(byUser.get('admin')).toMatchObject({ calls_ok: 1, calls_total: 1 })
    } finally {
      db.close()
    }
  })

  it('未传 userId 的调用归入"未归属"（user_id 为 null）', () => {
    const db = new UsageDb(path.join(dir, 'usage.db'))
    try {
      db.recordMcpCall('ocr', true)
      const [item] = db.mcpCallStats()
      expect(item!.users).toEqual([
        expect.objectContaining({ user_id: null, calls_ok: 1, calls_total: 1 }),
      ])
    } finally {
      db.close()
    }
  })

  it('回退警示只在日志里说清楚"退化到什么程度"，不吞掉错误', () => {
    const warn = vi.fn()
    const logger = { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
    const db = new UsageDb(path.join(dir, 'usage.db'), logger)
    db.close()
    // 正常文件系统上不会回退，因此不应出现该警示（守住"不误报"）
    expect(warn).not.toHaveBeenCalled()
  })
})
