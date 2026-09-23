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

  it('可记录 MCP 调用并读回统计：分组行四个时间窗 + 服务级汇总（任务 2026-09-15）', () => {
    const db = new UsageDb(path.join(dir, 'usage.db'))
    try {
      db.recordMcpCall({ service: 'ocr', tool: 'ocr_image', ok: true, durationMs: 12, userId: 'admin' })
      db.recordMcpCall({
        service: 'ocr',
        tool: 'ocr_image',
        ok: false,
        durationMs: 30,
        errorKind: 'transport',
        userId: 'admin',
      })
      const { items, groups } = db.mcpCallStats()

      // 分组行：一行一个「服务 × 工具 × 用户」，时间窗挂在这一层
      expect(groups).toHaveLength(1)
      expect(groups[0]).toMatchObject({
        service: 'ocr',
        tool_name: 'ocr_image',
        user_id: 'admin',
        calls_total: 2,
      })
      // 刚记录的调用落在所有时间窗内：各窗 total=2 / ok=1 / failed=1
      for (const key of ['h24', 'd7', 'd30', 'd365'] as const) {
        expect(groups[0]!.windows[key]).toEqual({ ok: 1, failed: 1, total: 2 })
      }

      // 服务级汇总由分组行折叠而来，口径都是"最近一年"，故两者恒相等
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ name: 'ocr', calls_total: 2, calls_ok: 1, calls_failed: 1 })
      expect(items[0]!.calls_total).toBe(groups[0]!.windows.d365.total)
      expect(items[0]!.last_called_at).toBe(groups[0]!.last_called_at)
    } finally {
      db.close()
    }
  })

  it('窗口内无调用时补 0 而不是缺字段：只落在 d365 的调用，短窗全为 0', () => {
    const dbPath = path.join(dir, 'usage.db')
    new UsageDb(dbPath).close()
    // 直接写一条 40 天前的调用：在"最近一年"内，但不在 24h/7天/30天 内
    const raw = new Database(dbPath)
    raw
      .prepare(
        `INSERT INTO mcp_call_events
           (service_name, tool_name, ok, called_at, user_id, thread_id, duration_ms, error_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'ocr',
        'ocr_image',
        1,
        new Date(Date.now() - 40 * 86_400_000).toISOString(),
        'admin',
        't1',
        5,
        null,
      )
    raw.close()

    const db = new UsageDb(dbPath)
    try {
      const { groups } = db.mcpCallStats()
      expect(groups[0]!.windows.h24).toEqual({ ok: 0, failed: 0, total: 0 })
      expect(groups[0]!.windows.d7).toEqual({ ok: 0, failed: 0, total: 0 })
      expect(groups[0]!.windows.d30).toEqual({ ok: 0, failed: 0, total: 0 })
      expect(groups[0]!.windows.d365).toEqual({ ok: 1, failed: 0, total: 1 })
    } finally {
      db.close()
    }
  })

  it('未出现过的服务不返回（由平台侧以 0 呈现）', () => {
    const db = new UsageDb(path.join(dir, 'usage.db'))
    try {
      expect(db.mcpCallStats()).toEqual({ items: [], groups: [] })
    } finally {
      db.close()
    }
  })

  it('分组行：同一服务下不同「工具 × 用户」各自成行（2026-09-23）', () => {
    const db = new UsageDb(path.join(dir, 'usage.db'))
    try {
      db.recordMcpCall({ service: 'ocr', tool: 'ocr_image', ok: true, durationMs: 1, userId: 'admin' })
      db.recordMcpCall({ service: 'ocr', tool: 'ocr_image', ok: false, durationMs: 1, userId: 'admin' })
      db.recordMcpCall({ service: 'ocr', tool: 'ocr_pdf', ok: true, durationMs: 1, userId: 'zpf' })
      const { items, groups } = db.mcpCallStats()

      // 排序：服务 → 工具 → 用户
      expect(groups.map((group) => [group.service, group.tool_name, group.user_id])).toEqual([
        ['ocr', 'ocr_image', 'admin'],
        ['ocr', 'ocr_pdf', 'zpf'],
      ])
      expect(groups[0]).toMatchObject({ calls_ok: 1, calls_failed: 1, calls_total: 2 })
      expect(groups[0]!.last_called_at).not.toBeNull()
      // 服务级汇总 = 该服务各分组行之和
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ name: 'ocr', calls_ok: 2, calls_failed: 1, calls_total: 3 })
    } finally {
      db.close()
    }
  })

  it('旧库迁移：老 schema 的事件表打开即补齐新增列，老行归入"未归属"（不丢历史）', () => {
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
      db.recordMcpCall({ service: 'ocr', tool: 'ocr_image', ok: true, durationMs: 8, userId: 'admin' })
      const { items, groups } = db.mcpCallStats()
      // 老行补列后三个维度都是 NULL：单独成组，而不是从统计里消失（`null` 排在该维度最前）
      expect(groups).toHaveLength(2)
      expect(groups[0]).toMatchObject({
        service: 'ocr',
        tool_name: null,
        user_id: null,
        calls_total: 1,
      })
      expect(groups[1]).toMatchObject({
        service: 'ocr',
        tool_name: 'ocr_image',
        user_id: 'admin',
        calls_total: 1,
      })
      // 服务级汇总把两类行都算进来（不丢历史）
      expect(items[0]).toMatchObject({ name: 'ocr', calls_total: 2, calls_ok: 2 })
    } finally {
      db.close()
    }
  })

  it('未传 userId 的调用归入"未归属"（user_id 为 null）', () => {
    const db = new UsageDb(path.join(dir, 'usage.db'))
    try {
      db.recordMcpCall({ service: 'ocr', tool: 'ocr_image', ok: true, durationMs: 3 })
      const { groups } = db.mcpCallStats()
      expect(groups).toEqual([
        expect.objectContaining({ user_id: null, tool_name: 'ocr_image', calls_ok: 1, calls_total: 1 }),
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

  it('事件明细落全字段：工具名 / 会话 / 耗时 / 错误分类（2026-09-23）', () => {
    const dbPath = path.join(dir, 'usage.db')
    const db = new UsageDb(dbPath)
    db.recordMcpCall({
      service: 'ocr',
      tool: 'ocr_image',
      ok: false,
      durationMs: 1234,
      errorKind: 'transport',
      userId: 'admin',
      threadId: 't1',
    })
    db.close()

    const raw = new Database(dbPath)
    try {
      const row = raw.prepare(`SELECT * FROM mcp_call_events`).get() as Record<string, unknown>
      expect(row).toMatchObject({
        service_name: 'ocr',
        // 工具名是 MCP 服务自己的名字，**不带**暴露给模型的 `ocr__` 前缀
        tool_name: 'ocr_image',
        ok: 0,
        duration_ms: 1234,
        error_kind: 'transport',
        user_id: 'admin',
        thread_id: 't1',
      })
      expect(row.called_at).toEqual(expect.any(String))
    } finally {
      raw.close()
    }
  })

  it('成功的调用不留错误分类（避免"有 error_kind 但 ok=1"的歧义行）', () => {
    const dbPath = path.join(dir, 'usage.db')
    const db = new UsageDb(dbPath)
    // 即便调用方传了 errorKind，成功时也必须清空
    db.recordMcpCall({ service: 'ocr', tool: 'ocr_image', ok: true, durationMs: 5, errorKind: 'transport' })
    db.close()

    const raw = new Database(dbPath)
    try {
      const row = raw.prepare(`SELECT ok, error_kind FROM mcp_call_events`).get() as {
        ok: number
        error_kind: string | null
      }
      expect(row.ok).toBe(1)
      expect(row.error_kind).toBeNull()
    } finally {
      raw.close()
    }
  })

  it('按工具分组：同一服务下的不同工具分别成行（2026-09-23 下钻粒度）', () => {
    const db = new UsageDb(path.join(dir, 'usage.db'))
    try {
      db.recordMcpCall({ service: 'ocr', tool: 'ocr_image', ok: true, durationMs: 10 })
      db.recordMcpCall({ service: 'ocr', tool: 'ocr_image', ok: false, durationMs: 20 })
      db.recordMcpCall({ service: 'ocr', tool: 'ocr_pdf', ok: true, durationMs: 30 })
      const { items, groups } = db.mcpCallStats()
      const byTool = new Map(groups.map((group) => [group.tool_name, group]))
      expect(byTool.get('ocr_image')).toMatchObject({ calls_ok: 1, calls_failed: 1, calls_total: 2 })
      expect(byTool.get('ocr_pdf')).toMatchObject({ calls_ok: 1, calls_failed: 0, calls_total: 1 })
      expect(byTool.get('ocr_image')!.last_called_at).toEqual(expect.any(String))
      expect(items[0]).toMatchObject({ name: 'ocr', calls_total: 3 })
    } finally {
      db.close()
    }
  })
})
