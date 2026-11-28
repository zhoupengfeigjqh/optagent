/**
 * 单会话登记 · MySQL 驱动（028 特性，阶段 1）。
 *
 * 落在 `optagent.sessions` 表（`user_id` 主键 = 单会话唯一），语义与
 * `.platform-data/sessions/{uid}.json` 一一对应：
 * - `setCurrentSession` = `INSERT … ON DUPLICATE KEY UPDATE`（后登踢前登）；
 * - `clearSession` = `DELETE`（幂等，不做前置探测）；
 * - 读取**每次查表**，不保留内存投影：会话是安全边界，缓存会让其它实例或运维脚本
 *   造成的失效看不见（file 驱动同样是每次读盘）。
 *
 * `issued_at` 由数据库 `NOW(3)` 生成（仅审计展示用，不参与判定）。
 */
import type { MysqlConnection } from '../../infra/mysql.js';
import type { SessionPort } from './session-store.js';

interface SessionRow {
  session_id: string;
}

export class MysqlSessionStore implements SessionPort {
  constructor(private readonly conn: MysqlConnection) {}

  /** 启动期探表（schema 未执行即拒绝启动） */
  async init(): Promise<void> {
    await this.conn.select('SELECT 1 FROM sessions LIMIT 1');
  }

  async setCurrentSession(userId: string, sessionId: string): Promise<void> {
    await this.conn.modify(
      `INSERT INTO sessions (user_id, session_id, issued_at)
       VALUES (?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE session_id = VALUES(session_id), issued_at = NOW(3)`,
      [userId, sessionId],
    );
  }

  async getCurrentSession(userId: string): Promise<string | null> {
    const rows = await this.conn.select<SessionRow>(
      'SELECT session_id FROM sessions WHERE user_id = ?',
      [userId],
    );
    return rows[0]?.session_id ?? null;
  }

  async clearSession(userId: string): Promise<void> {
    await this.conn.modify('DELETE FROM sessions WHERE user_id = ?', [userId]);
  }

  async isCurrentSession(userId: string, sessionId: string): Promise<boolean> {
    return (await this.getCurrentSession(userId)) === sessionId;
  }
}
