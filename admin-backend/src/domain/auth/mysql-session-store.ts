/**
 * 单会话登记 · MySQL 驱动（028 特性，阶段 1）。
 *
 * 落在 `optagent.sessions` 表（`user_id` 主键 = 单会话唯一），语义与
 * `.platform-data/sessions/{uid}.json` 一一对应：
 * - `setCurrentSession` = `INSERT … ON DUPLICATE KEY UPDATE`（后登踢前登）；
 * - `clearSession` = `DELETE`（幂等）；
 * - 读取走**内存投影**（`init()` 全量加载），`isCurrentSession` 保持同步，
 *   `AuthService.introspect` / 运行侧内省契约零改动。
 *
 * `issued_at` 由数据库 `NOW(3)` 生成（仅审计展示用，不参与判定）。
 */
import type { MysqlConnection } from '../../infra/mysql.js';
import type { SessionPort } from './session-store.js';

interface SessionRow {
  user_id: string;
  session_id: string;
}

export class MysqlSessionStore implements SessionPort {
  private readonly rows = new Map<string, string>();

  constructor(private readonly conn: MysqlConnection) {}

  /** 启动期全量加载内存投影（wiring 时调用；失败 = 服务拒绝启动） */
  async init(): Promise<void> {
    const rows = await this.conn.select<SessionRow>('SELECT user_id, session_id FROM sessions');
    this.rows.clear();
    for (const row of rows) {
      this.rows.set(row.user_id, row.session_id);
    }
  }

  async setCurrentSession(userId: string, sessionId: string): Promise<void> {
    await this.conn.modify(
      `INSERT INTO sessions (user_id, session_id, issued_at)
       VALUES (?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE session_id = VALUES(session_id), issued_at = NOW(3)`,
      [userId, sessionId],
    );
    this.rows.set(userId, sessionId);
  }

  getCurrentSession(userId: string): string | null {
    return this.rows.get(userId) ?? null;
  }

  async clearSession(userId: string): Promise<void> {
    // 幂等：无登记即直接返回（与 file 版 `exists` 前置检查同口径，不打无谓 SQL）
    if (!this.rows.has(userId)) return;
    await this.conn.modify('DELETE FROM sessions WHERE user_id = ?', [userId]);
    this.rows.delete(userId);
  }

  isCurrentSession(userId: string, sessionId: string): boolean {
    return this.getCurrentSession(userId) === sessionId;
  }
}
