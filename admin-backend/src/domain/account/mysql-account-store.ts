/**
 * 账号域 mysql 驱动（028 阶段 2/3）：两张表直读直写。
 *
 * `user_agent_grants` 已于 2026-11-27 下线（授权 = 关联 = `users.agents`），
 * 本驱动不再读写该表；旧表可留作历史审计。
 *
 * 与 `MysqlUserRepository` 的「内存投影 + 同步读」不同：本端口全异步、
 * 每次读走 SQL（消费方只有新增路由，无同步消费方——方案 §8.3 承诺不受影响）。
 *
 * 时间戳由 `nowDatetime()`（本地时区字符串）统一生成，与
 * `dateStrings: true` 的读出形态一致（见 `account-store.ts`）。
 */
import { isDuplicateEntry, type MysqlConnection } from '../../infra/mysql.js';
import {
  DuplicateAgentCodeError,
  nowDatetime,
  type AccountStorePort,
  type AgentServiceRecord,
  type RegisterLinkRecord,
} from './account-store.js';

interface ServiceRow {
  code: string;
  name: string;
  platform_agent_name: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface LinkRow {
  token: string;
  agent_code: string;
  created_by: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  use_count: number;
  created_at: string;
}

export class MysqlAccountStore implements AccountStorePort {
  constructor(private readonly conn: MysqlConnection) {}

  async init(): Promise<void> {
    // 连通性已由 wiring 期的 `ping()` 验证；这里仅探表存在性（schema 未执行即拒绝启动）
    await this.conn.select('SELECT 1 FROM agent_services LIMIT 1');
  }

  /* ---- 数字人服务 ---- */

  async listAgentServices(): Promise<AgentServiceRecord[]> {
    const rows = await this.conn.select<ServiceRow>(
      'SELECT code, name, platform_agent_name, status, created_at, updated_at FROM agent_services ORDER BY code',
    );
    return rows.map(toServiceRecord);
  }

  async findAgentService(code: string): Promise<AgentServiceRecord | null> {
    const rows = await this.conn.select<ServiceRow>(
      'SELECT code, name, platform_agent_name, status, created_at, updated_at FROM agent_services WHERE code = ?',
      [code],
    );
    return rows[0] ? toServiceRecord(rows[0]) : null;
  }

  async saveAgentService(record: AgentServiceRecord): Promise<void> {
    const now = nowDatetime();
    try {
      await this.conn.modify(
        `INSERT INTO agent_services (code, name, platform_agent_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           platform_agent_name = VALUES(platform_agent_name),
           status = VALUES(status),
           updated_at = VALUES(updated_at)`,
        [record.code, record.name, record.platform_agent_name, record.status, now, now],
      );
    } catch (err) {
      if (isDuplicateEntry(err)) {
        return; // upsert 语义：冲突 = 已存在，由上层预检负责业务码
      }
      throw err;
    }
  }

  async insertAgentService(record: AgentServiceRecord): Promise<void> {
    const now = nowDatetime();
    try {
      // 纯 INSERT（不是 upsert）：创建撞码必须失败，MUST NOT 覆盖既有服务
      await this.conn.modify(
        `INSERT INTO agent_services (code, name, platform_agent_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [record.code, record.name, record.platform_agent_name, record.status, now, now],
      );
    } catch (err) {
      if (isDuplicateEntry(err)) throw new DuplicateAgentCodeError(record.code);
      throw err;
    }
  }

  async removeAgentService(code: string): Promise<void> {
    await this.conn.modify('DELETE FROM agent_services WHERE code = ?', [code]);
  }

  /* ---- 专属注册链接 ---- */

  async listRegisterLinks(): Promise<RegisterLinkRecord[]> {
    const rows = await this.conn.select<LinkRow>(
      'SELECT token, agent_code, created_by, expires_at, revoked_at, use_count, created_at FROM register_links ORDER BY created_at ASC, token ASC',
    );
    return rows.map(toLinkRecord);
  }

  async findRegisterLink(token: string): Promise<RegisterLinkRecord | null> {
    const rows = await this.conn.select<LinkRow>(
      'SELECT token, agent_code, created_by, expires_at, revoked_at, use_count, created_at FROM register_links WHERE token = ?',
      [token],
    );
    return rows[0] ? toLinkRecord(rows[0]) : null;
  }

  async saveRegisterLink(record: RegisterLinkRecord): Promise<void> {
    try {
      await this.conn.modify(
        `INSERT INTO register_links (token, agent_code, created_by, expires_at, revoked_at, use_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           expires_at = VALUES(expires_at),
           revoked_at = VALUES(revoked_at),
           use_count = VALUES(use_count)`,
        [
          record.token,
          record.agent_code,
          record.created_by,
          record.expires_at,
          record.revoked_at,
          record.use_count,
          record.created_at,
        ],
      );
    } catch (err) {
      if (isDuplicateEntry(err)) return;
      throw err;
    }
  }

  async revokeLinksOf(agentCodes: string[], revokedAt: string): Promise<number> {
    if (agentCodes.length === 0) return 0;
    const placeholders = agentCodes.map(() => '?').join(', ');
    const { affectedRows } = await this.conn.modify(
      `UPDATE register_links SET revoked_at = ? WHERE revoked_at IS NULL AND agent_code IN (${placeholders})`,
      [revokedAt, ...agentCodes],
    );
    return affectedRows;
  }

  async incrementUseCount(token: string): Promise<void> {
    await this.conn.modify('UPDATE register_links SET use_count = use_count + 1 WHERE token = ?', [token]);
  }
}

function toServiceRecord(row: ServiceRow): AgentServiceRecord {
  return {
    code: row.code,
    name: row.name,
    platform_agent_name: row.platform_agent_name,
    status: row.status === 'disabled' ? 'disabled' : 'enabled',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toLinkRecord(row: LinkRow): RegisterLinkRecord {
  return {
    token: row.token,
    agent_code: row.agent_code,
    created_by: row.created_by,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    use_count: Number(row.use_count),
    created_at: row.created_at,
  };
}


