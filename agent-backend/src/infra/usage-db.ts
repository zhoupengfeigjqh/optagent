import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import type {
  McpCallEvent,
  McpCallGroupStat,
  McpCallStat,
  McpCallStats,
  UsageFilter,
  UsageRecord,
  UsageStore,
  UsageSummary,
} from '../types.js';

export type JournalModeOutcome = 'WAL' | 'DELETE' | 'default';

const MCP_EVENT_RETENTION_MS = 365 * 86_400_000;

export function applyJournalModeSafely(
  pragma: (mode: 'WAL' | 'DELETE') => unknown,
  onFallback: (code: string) => void,
): JournalModeOutcome {
  try {
    pragma('WAL');
    return 'WAL';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    onFallback(code);
    try {
      pragma('DELETE');
      return 'DELETE';
    } catch {
      return 'default';
    }
  }
}

/** `-shm` 打不开（共享内存不可用，或上一次运行留下了陈旧的 `-shm`） */
export function isShmOpenFailure(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'SQLITE_IOERR_SHMOPEN';
}

export function describeShmOpenFailure(dbPath: string, code: string | undefined): string {
  return (
    `无法打开用量库 ${dbPath}（${code ?? 'SQLITE_IOERR_SHMOPEN'}）：` +
    'SQLite 需要创建或打开 -shm 共享内存文件，但当前无法打开它。' +
    '常见原因与处置：' +
    `① 上一次运行留下了陈旧文件 —— 停止容器后备份并删除 ${dbPath}-shm（必要时连同 -wal，先备份再删），再重启；` +
    '② 该目录不支持共享内存（部分网络/绑定挂载）—— 改用容器卷，或把 .opt-agent 放到支持共享内存的存储上。' +
    '（数据本身未损坏：可先把库复制到支持共享内存的位置打开并 checkpoint，再放回。）'
  );
}

export class UsageDb implements UsageStore {
  private readonly db: Database.Database;
  private readonly logger?: Logger;

  constructor(dbPath: string, logger?: Logger) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    if (logger) this.logger = logger;
    const journalMode = applyJournalModeSafely(
      (mode) => this.db.pragma(`journal_mode = ${mode}`),
      (code) =>
        this.logger?.warn(
          { event: 'usage.db.wal.unavailable', scope: 'system', code, dbPath },
          `当前文件系统不支持 WAL（${code}），已回退到 DELETE 日志模式；功能可用，仅失去并发写收益`,
        ),
    );
    if (journalMode !== 'WAL') {
      this.logger?.info(
        { event: 'usage.db.journal_mode', scope: 'system', journalMode },
        `usage.db 日志模式：${journalMode}`,
      );
    }
    try {
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_thread ON usage_records(thread_id);
      CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage_records(agent_name);
      CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at);

      -- R4：MCP 工具调用计数。与用量表共库，不新增数据库引擎（原则六）。
      -- 用 CREATE TABLE IF NOT EXISTS：无需迁移步骤，老库打开即自动补表。
      --
      -- 2026-09-23：**只保留事件明细一张表**。原 mcp_call_stats 累计表已删除——
      -- 明细本就只留一年，与"只看最近一年"的既定口径不存在"全历史累计"需求；
      -- 而一张停写后会冻结在切换时刻的表，比删掉更容易被误读。
      --
      -- 任务 2026-09-15：每次调用一行事件明细，支撑"最近24h/7天/30天/1年"时间窗聚合；
      -- 事件只保留一年（与最长统计窗对齐），更早的由 recordMcpCall 顺手清理。
      -- user_id（2026-09-16 十四次调整）：调用发起用户，支撑按用户明细；老行可能为 NULL
      -- tool_name / thread_id / duration_ms / error_kind（2026-09-23）：见 types.ts 的 McpCallEvent
      CREATE TABLE IF NOT EXISTS mcp_call_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_name TEXT NOT NULL,
        ok INTEGER NOT NULL,
        called_at TEXT NOT NULL,
        user_id TEXT,
        tool_name TEXT,
        thread_id TEXT,
        duration_ms INTEGER,
        error_kind TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_events_time ON mcp_call_events(called_at);
      -- 一次性清理：累计表已无读者，删掉避免留孤儿表（幂等，见上方 2026-09-23 说明）
      DROP TABLE IF EXISTS mcp_call_stats;
    `);
      // 注意：建在这些列上的索引必须在补列**之后**建——老库此刻还没有这些列。
      const eventColumns = new Set(
        (
          this.db.prepare(`PRAGMA table_info(mcp_call_events)`).all() as Array<{ name: string }>
        ).map((column) => column.name),
      );
      const addableColumns: Array<[string, string]> = [
        ['user_id', 'TEXT'],
        ['tool_name', 'TEXT'],
        ['thread_id', 'TEXT'],
        ['duration_ms', 'INTEGER'],
        ['error_kind', 'TEXT'],
      ];
      for (const [name, definition] of addableColumns) {
        if (!eventColumns.has(name)) {
          this.db.exec(`ALTER TABLE mcp_call_events ADD COLUMN ${name} ${definition}`);
        }
      }
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_mcp_events_user ON mcp_call_events(service_name, user_id);
        CREATE INDEX IF NOT EXISTS idx_mcp_events_tool ON mcp_call_events(service_name, tool_name, called_at);
        CREATE INDEX IF NOT EXISTS idx_mcp_events_thread ON mcp_call_events(thread_id);
      `);
    } catch (err) {
      if (isShmOpenFailure(err)) {
        throw new Error(describeShmOpenFailure(dbPath, (err as NodeJS.ErrnoException).code), {
          cause: err,
        });
      }
      throw err;
    }
  }

  record(entry: Omit<UsageRecord, 'id'>): void {
    try {
      this.db
        .prepare(
          `INSERT INTO usage_records (user_id, thread_id, agent_name, input_tokens, output_tokens, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.userId,
          entry.threadId,
          entry.agentName,
          entry.inputTokens,
          entry.outputTokens,
          entry.createdAt,
        );
    } catch (err) {
      this.logger?.error({ event: 'usage.record.failed', err }, 'usage 写入失败（不阻断对话）');
    }
  }

  summary(filter: UsageFilter): UsageSummary {
    const where: string[] = ['user_id = ?'];
    const params: unknown[] = [filter.userId];
    if (filter.threadId) {
      where.push('thread_id = ?');
      params.push(filter.threadId);
    }
    if (filter.agentName) {
      where.push('agent_name = ?');
      params.push(filter.agentName);
    }
    if (filter.from) {
      where.push('created_at >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      where.push('created_at <= ?');
      params.push(filter.to);
    }
    const clause = where.join(' AND ');

    const total = this.db
      .prepare(
        `SELECT COALESCE(SUM(input_tokens),0) AS inputTokens,
                COALESCE(SUM(output_tokens),0) AS outputTokens,
                COUNT(*) AS count
         FROM usage_records WHERE ${clause}`,
      )
      .get(...params) as UsageSummary['total'];

    const grouped = this.db
      .prepare(
        `SELECT thread_id AS threadId, agent_name AS agentName,
                SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
                COUNT(*) AS count
         FROM usage_records WHERE ${clause}
         GROUP BY thread_id, agent_name
         ORDER BY inputTokens DESC`,
      )
      .all(...params) as UsageSummary['grouped'];

    return { total, grouped };
  }

  recordMcpCall(entry: McpCallEvent): void {
    try {
      const now = new Date().toISOString();
      // 写入与"顺手清理"包进同一事务：避免事件已落、清理半途失败的中间态
      this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO mcp_call_events
               (service_name, tool_name, ok, called_at, user_id, thread_id, duration_ms, error_kind)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            entry.service,
            entry.tool,
            entry.ok ? 1 : 0,
            now,
            entry.userId ?? null,
            entry.threadId ?? null,
            entry.durationMs,
            // 成功时不留错误分类，避免"有 error_kind 但 ok=1"的歧义行
            entry.ok ? null : (entry.errorKind ?? null),
          );
        this.db
          .prepare(`DELETE FROM mcp_call_events WHERE called_at < ?`)
          .run(new Date(Date.now() - MCP_EVENT_RETENTION_MS).toISOString());
      })();
    } catch (err) {
      this.logger?.error({ event: 'mcp.stats.record.failed', err }, 'MCP 调用统计写入失败');
    }
  }

  private static readonly WINDOWS: Array<{ key: 'h24' | 'd7' | 'd30' | 'd365'; ms: number }> = [
    { key: 'h24', ms: 24 * 3_600_000 },
    { key: 'd7', ms: 7 * 86_400_000 },
    { key: 'd30', ms: 30 * 86_400_000 },
    { key: 'd365', ms: MCP_EVENT_RETENTION_MS },
  ];

  mcpCallStats(): McpCallStats {
    const groups = new Map<string, McpCallGroupStat>();
    for (const { key, ms } of UsageDb.WINDOWS) {
      const rows = this.db
        .prepare(
          `SELECT service_name, tool_name, user_id,
                  COALESCE(SUM(ok), 0) AS ok,
                  COALESCE(SUM(1 - ok), 0) AS failed,
                  MAX(called_at) AS last_called_at
           FROM mcp_call_events WHERE called_at >= ?
           GROUP BY service_name, tool_name, user_id`,
        )
        .all(new Date(Date.now() - ms).toISOString()) as Array<{
        service_name: string;
        tool_name: string | null;
        user_id: string | null;
        ok: number;
        failed: number;
        last_called_at: string;
      }>;
      for (const row of rows) {
        const id = `${row.service_name}\u0000${row.tool_name ?? ''}\u0000${row.user_id ?? ''}`;
        const group = groups.get(id) ?? {
          service: row.service_name,
          tool_name: row.tool_name,
          user_id: row.user_id,
          calls_total: 0,
          calls_ok: 0,
          calls_failed: 0,
          last_called_at: null,
          // 每个分组行各自持有窗口对象（不能共享同一个引用）
          windows: {
            h24: { ok: 0, failed: 0, total: 0 },
            d7: { ok: 0, failed: 0, total: 0 },
            d30: { ok: 0, failed: 0, total: 0 },
            d365: { ok: 0, failed: 0, total: 0 },
          },
        };
        group.windows[key] = { ok: row.ok, failed: row.failed, total: row.ok + row.failed };
        if (key === 'd365') {
          group.calls_ok = row.ok;
          group.calls_failed = row.failed;
          group.calls_total = row.ok + row.failed;
          group.last_called_at = row.last_called_at;
        }
        groups.set(id, group);
      }
    }

    const ordered = [...groups.values()].sort(
      (a, b) =>
        a.service.localeCompare(b.service) ||
        (a.tool_name ?? '').localeCompare(b.tool_name ?? '') ||
        (a.user_id ?? '').localeCompare(b.user_id ?? ''),
    );

    const items = new Map<string, McpCallStat>();
    for (const group of ordered) {
      const acc = items.get(group.service) ?? {
        name: group.service,
        calls_total: 0,
        calls_ok: 0,
        calls_failed: 0,
        last_called_at: null,
      };
      acc.calls_total += group.calls_total;
      acc.calls_ok += group.calls_ok;
      acc.calls_failed += group.calls_failed;
      if (
        group.last_called_at !== null &&
        (acc.last_called_at === null || group.last_called_at > acc.last_called_at)
      ) {
        acc.last_called_at = group.last_called_at;
      }
      items.set(group.service, acc);
    }

    return { items: [...items.values()], groups: ordered };
  }

  close(): void {
    this.db.close();
  }
}
