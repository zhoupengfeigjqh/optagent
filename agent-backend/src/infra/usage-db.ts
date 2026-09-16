/**
 * Token 用量存储：better-sqlite3 全局单库 `.opt-agent/usage.db`。
 *
 * - 表 usage_records + 索引（thread_id / agent_name / created_at，章程 IV）
 * - record 失败记日志不抛出（不影响对话响应）
 * - summary 走 SQL 聚合，按过滤条件命中索引
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import type { McpCallStat, McpCallUserStat, McpCallWindow, UsageFilter, UsageRecord, UsageStore, UsageSummary } from '../types.js';

export type JournalModeOutcome = 'WAL' | 'DELETE' | 'default';

/**
 * 选择日志模式：**优先 WAL，不支持则回退 DELETE**。
 *
 * **为什么需要这个回退**（实测缺陷，见 `quickstart.md` §10.3）：
 * WAL 需要创建并 `mmap` 一个 `-shm` 共享内存文件。部分文件系统**不支持共享内存**，
 * 此时 `pragma('journal_mode = WAL')` 会抛 `SQLITE_IOERR_SHMOPEN`，
 * 而它发生在 `UsageDb` 构造里 → **整个服务起不来**，容器表现为无限重启
 * （本地开发用 Windows + Docker Desktop 的绑定挂载就是这个情形：
 * 同一个 `usage.db` 复制到容器内打开 WAL 一切正常，放在绑定挂载上就失败，
 * 说明是文件系统能力问题而非数据损坏）。
 *
 * 回退后功能**完全可用**，只失去 WAL 的并发写收益；交付形态（Linux）不受影响。
 * 抽成可注入 `pragma` 的函数是为了单测能覆盖该分支（不必真的去找一块坏盘）。
 */
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
      // 连显式设置都失败：保持 SQLite 默认（DELETE）继续，读写仍然可用
      return 'default';
    }
  }
}

/** `-shm` 打不开（共享内存不可用，或上一次运行留下了陈旧的 `-shm`） */
export function isShmOpenFailure(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'SQLITE_IOERR_SHMOPEN';
}

/**
 * 把 `SQLITE_IOERR_SHMOPEN` 翻译成**可操作**的说明。
 *
 * 原始报错只有一句 `SqliteError: disk I/O error`，与"磁盘坏了"无法区分，
 * 而真实原因通常是二者之一：
 * ① 当前文件系统不支持共享内存（WAL 需要 `mmap` 一个 `-shm`）；
 * ② **上一次容器运行留下的陈旧 `-shm`**——新容器在绑定挂载上无法重新打开它
 *    （实测：同一个库复制到容器内可正常打开，留在绑定挂载上则失败，
 *    而**新建**的库在同一挂载上一切正常，说明不是文件系统能力问题）。
 */
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

      -- R4：MCP 工具调用计数（按服务名）。与用量表共库，不新增数据库引擎（原则六）。
      -- 用 CREATE TABLE IF NOT EXISTS：无需迁移步骤，老库打开即自动补表。
      CREATE TABLE IF NOT EXISTS mcp_call_stats (
        service_name TEXT PRIMARY KEY,
        calls_ok INTEGER NOT NULL DEFAULT 0,
        calls_failed INTEGER NOT NULL DEFAULT 0,
        last_called_at TEXT
      );
      -- 任务 2026-09-15：每次调用一行事件明细，支撑"最近24h/7天/30天/1年"时间窗聚合；
      -- 事件只保留一年（与最长统计窗对齐），更早的由 recordMcpCall 顺手清理。
      -- user_id（2026-09-16 十四次调整）：调用发起用户，支撑按用户明细；老行可能为 NULL
      CREATE TABLE IF NOT EXISTS mcp_call_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_name TEXT NOT NULL,
        ok INTEGER NOT NULL,
        called_at TEXT NOT NULL,
        user_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_events_time ON mcp_call_events(called_at);
    `);
      // 旧库迁移：事件表在 user_id 列加入之前就已存在的库，打开时补列（SQLite 无 IF NOT EXISTS 修饰 ADD COLUMN，
      // 故先查 pragma table_info；与 CREATE TABLE IF NOT EXISTS 同一"打开即自愈"口径，无需人工迁移步骤）。
      // 注意：按 user_id 的索引必须在补列**之后**建——老库此刻还没有这一列。
      const eventColumns = this.db.prepare(`PRAGMA table_info(mcp_call_events)`).all() as Array<{
        name: string;
      }>;
      if (!eventColumns.some((column) => column.name === 'user_id')) {
        this.db.exec(`ALTER TABLE mcp_call_events ADD COLUMN user_id TEXT`);
      }
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_events_user ON mcp_call_events(service_name, user_id)`);
    } catch (err) {
      if (isShmOpenFailure(err)) {
        throw new Error(describeShmOpenFailure(dbPath, (err as NodeJS.ErrnoException).code), { cause: err });
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

  /**
   * 记一次 MCP **工具调用**（`plan.md` R4、`FR-049`/`FR-050`）。
   *
   * 口径是**工具调用次数**——每次 `tools/call` 计一次，成功/失败分列。
   * 这里刻意不用"HTTP 请求数"：一次 streamable-http 会话可能包含
   * `initialize` / `tools/list` / 多次 `tools/call`，二者不等价，
   * 用请求数会给出误导性数字（`research.md` D6）。
   *
   * `userId` 记进事件明细（一次调用一行），供按用户明细聚合；缺省/null 为
   * 升级前的历史事件（界面显示"未归属"）。
   *
   * 写入失败只记日志不抛出——统计是观测能力，MUST NOT 影响对话主链路。
   */
  recordMcpCall(serviceName: string, ok: boolean, userId?: string | null): void {
    try {
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO mcp_call_stats (service_name, calls_ok, calls_failed, last_called_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(service_name) DO UPDATE SET
             calls_ok = calls_ok + excluded.calls_ok,
             calls_failed = calls_failed + excluded.calls_failed,
             last_called_at = excluded.last_called_at`,
        )
        .run(serviceName, ok ? 1 : 0, ok ? 0 : 1, now);
      // 事件明细：时间窗与按用户明细的数据源（一次调用一行）
      this.db
        .prepare(`INSERT INTO mcp_call_events (service_name, ok, called_at, user_id) VALUES (?, ?, ?, ?)`)
        .run(serviceName, ok ? 1 : 0, now, userId ?? null);
      // 事件只保留一年：与最长统计窗对齐，顺手清理（低频调用下代价可忽略）
      this.db
        .prepare(`DELETE FROM mcp_call_events WHERE called_at < ?`)
        .run(new Date(Date.now() - 365 * 86_400_000).toISOString());
    } catch (err) {
      this.logger?.error({ event: 'mcp.stats.record.failed', err }, 'MCP 调用统计写入失败');
    }
  }

  /** 时间窗定义：最近 24h / 7 天 / 30 天 / 1 年（任务 2026-09-15） */
  private static readonly WINDOWS: Array<{ key: 'h24' | 'd7' | 'd30' | 'd365'; ms: number }> = [
    { key: 'h24', ms: 24 * 3_600_000 },
    { key: 'd7', ms: 7 * 86_400_000 },
    { key: 'd30', ms: 30 * 86_400_000 },
    { key: 'd365', ms: 365 * 86_400_000 },
  ];

  /** 全部服务的调用统计（未出现过的服务不在此列，由平台侧以 0 呈现） */
  mcpCallStats(): McpCallStat[] {
    const rows = this.db
      .prepare(
        `SELECT service_name AS name, calls_ok, calls_failed, last_called_at
         FROM mcp_call_stats ORDER BY service_name`,
      )
      .all() as Array<{
      name: string;
      calls_ok: number;
      calls_failed: number;
      last_called_at: string | null;
    }>;

    // 各时间窗聚合：每次调用的事件明细行上做 GROUP BY
    const zero: McpCallWindow = { ok: 0, failed: 0, total: 0 };
    const byService = new Map<string, Record<string, McpCallWindow>>();
    for (const { key, ms } of UsageDb.WINDOWS) {
      const since = new Date(Date.now() - ms).toISOString();
      const rowsW = this.db
        .prepare(
          `SELECT service_name AS name,
                  COALESCE(SUM(ok), 0) AS ok,
                  COALESCE(SUM(1 - ok), 0) AS failed,
                  COUNT(*) AS total
           FROM mcp_call_events WHERE called_at >= ? GROUP BY service_name`,
        )
        .all(since) as Array<{ name: string; ok: number; failed: number; total: number }>;
      for (const row of rowsW) {
        const bucket = byService.get(row.name) ?? {};
        bucket[key] = { ok: row.ok, failed: row.failed, total: row.total };
        byService.set(row.name, bucket);
      }
    }

    // 按用户明细：在事件明细上 GROUP BY（user_id 为 NULL 的老行归入 "未归属"）
    const userRows = this.db
      .prepare(
        `SELECT service_name AS name,
                user_id,
                COALESCE(SUM(ok), 0) AS ok,
                COALESCE(SUM(1 - ok), 0) AS failed,
                MAX(called_at) AS last_called_at
         FROM mcp_call_events GROUP BY service_name, user_id`,
      )
      .all() as Array<{
      name: string;
      user_id: string | null;
      ok: number;
      failed: number;
      last_called_at: string | null;
    }>;
    const usersByService = new Map<string, McpCallUserStat[]>();
    for (const row of userRows) {
      const list = usersByService.get(row.name) ?? [];
      list.push({
        user_id: row.user_id,
        calls_ok: row.ok,
        calls_failed: row.failed,
        calls_total: row.ok + row.failed,
        last_called_at: row.last_called_at,
      });
      usersByService.set(row.name, list);
    }

    return rows.map((row) => {
      const bucket = byService.get(row.name) ?? {};
      const w = (key: 'h24' | 'd7' | 'd30' | 'd365'): McpCallWindow => bucket[key] ?? zero;
      return {
        name: row.name,
        calls_total: row.calls_ok + row.calls_failed,
        calls_ok: row.calls_ok,
        calls_failed: row.calls_failed,
        last_called_at: row.last_called_at,
        windows: { h24: w('h24'), d7: w('d7'), d30: w('d30'), d365: w('d365') },
        users: usersByService.get(row.name) ?? [],
      };
    });
  }

  close(): void {
    this.db.close();
  }
}
