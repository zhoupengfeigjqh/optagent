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
import type { UsageFilter, UsageRecord, UsageStore, UsageSummary } from '../types.js';

export class UsageDb implements UsageStore {
  private readonly db: Database.Database;
  private readonly logger?: Logger;

  constructor(dbPath: string, logger?: Logger) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    if (logger) this.logger = logger;
    this.db.pragma('journal_mode = WAL');
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
    `);
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

  close(): void {
    this.db.close();
  }
}
