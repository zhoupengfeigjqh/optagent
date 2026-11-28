/**
 * 搬运集成用例（029 T021）：真库 + 真脚本，跑两次断言幂等，且管理员角色/手机号保留。
 *
 * 真脚本通过 `node --import tsx scripts/migrate-to-mysql.ts` 启动（与运维命令同一入口）。
 * 本地 MySQL 不可达时先打印"已跳过"再跳过。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recreateSchema } from '../helpers/mysql-schema.js';

const HOST = process.env.TEST_MYSQL_HOST ?? '127.0.0.1';
const PORT = Number(process.env.TEST_MYSQL_PORT ?? 3306);
const USER = process.env.TEST_MYSQL_USER ?? 'root';
const PASSWORD = process.env.TEST_MYSQL_PASSWORD ?? '123456';
/** 独立库：vitest 并行跑文件，共用 `optagent_test` 会互相 drop */
const TEST_DB = 'optagent_test_migrate';
const PROJECT_ROOT = path.resolve(process.cwd());

const STAMP = '2026-11-28 09:00:00.000';

const adminDoc = {
  user_id: 'admin',
  phone: '13800000000',
  display_name: '管理员',
  role: 'admin',
  password: { algo: 'scrypt', params: {}, salt: 'salt-1', hash: 'hash-1' },
  agents: ['BOM数字人'],
  source_agent_code: 'DH-BOM001',
};

const plainDoc = { user_id: 'u_1', agents: [] as string[] };

const services = [
  {
    code: 'DH-BOM001',
    name: 'BOM数字人',
    platform_agent_name: 'BOM数字人',
    status: 'enabled',
    created_at: STAMP,
    updated_at: STAMP,
  },
];

const links = [
  {
    token: 'tok-1',
    agent_code: 'DH-BOM001',
    created_by: null,
    expires_at: null,
    revoked_at: null,
    use_count: 2,
    created_at: STAMP,
  },
];

const sessions = [{ user_id: 'admin', session_id: 'sess-1', issued_at: '2026-11-27T12:53:55.461Z' }];

let available: boolean;
try {
  const probe = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
  await probe.ping();
  await probe.end();
  available = true;
} catch {
  console.warn(`[migrate-mysql] 本地 MySQL 不可达（${HOST}:${PORT}），已跳过真实库搬运用例`);
  available = false;
}

describe.skipIf(!available)('搬运脚本（真库）：全字段、幂等、管理员保留', () => {
  let root: string;
  let admin: mysql.Connection;
  let countsAfterFirstRun: Record<'u' | 's' | 'a' | 'l', number>;

  async function countRows(): Promise<Record<'u' | 's' | 'a' | 'l', number>> {
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      'SELECT (SELECT COUNT(*) FROM users) AS u, (SELECT COUNT(*) FROM sessions) AS s, (SELECT COUNT(*) FROM agent_services) AS a, (SELECT COUNT(*) FROM register_links) AS l',
    );
    const row = rows[0]!;
    return { u: Number(row.u), s: Number(row.s), a: Number(row.a), l: Number(row.l) };
  }

  function writeSource(name: string, content: unknown): void {
    const file = path.join(root, ...name.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(content, null, 2), 'utf8');
  }

  function runMigrate(): string {
    return execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-to-mysql.ts'], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        STORAGE_DRIVER: 'mysql',
        MYSQL_HOST: HOST,
        MYSQL_PORT: String(PORT),
        MYSQL_USER: USER,
        MYSQL_PASSWORD: PASSWORD,
        MYSQL_DATABASE: TEST_DB,
        PLATFORM_DATA_DIR: root,
        OPT_AGENT_ROOT: path.join(root, 'opt-agent'),
        AUTH_SECRET: 'test-secret-for-migrate-spec-32ch',
        PORT: '3999',
      },
      encoding: 'utf8',
    });
  }

  beforeAll(async () => {
    admin = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
    await recreateSchema(admin, TEST_DB);
    await admin.query(`USE ${TEST_DB}`);

    root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-src-'));
    writeSource('accounts/users/admin.json', adminDoc);
    writeSource('accounts/users/u_1.json', plainDoc);
    writeSource('accounts/sessions/admin.json', sessions[0]);
    writeSource('accounts/agent-services.json', services);
    writeSource('accounts/register-links.json', links);
  });

  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.end();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('一次搬运写全四类实体，管理员角色与手机号被保留', async () => {
    const output = runMigrate();
    expect(output).toContain('逐列一致');

    const [users] = await admin.query<mysql.RowDataPacket[]>('SELECT * FROM users ORDER BY user_id');
    expect(users).toHaveLength(2);
    const adminRow = users.find((row) => row.user_id === 'admin')!;
    expect(adminRow.role).toBe('admin');
    expect(adminRow.phone).toBe('13800000000');
    expect(adminRow.display_name).toBe('管理员');
    expect(adminRow.source_agent_code).toBe('DH-BOM001');

    // issued_at：本地时间字符串落库后仍是同一时刻（时区偏移不得整体错位）
    const [sessionsRows] = await admin.query<mysql.RowDataPacket[]>('SELECT * FROM sessions');
    expect(sessionsRows).toHaveLength(1);
    const issued = sessionsRows[0]!.issued_at as Date;
    expect(issued.getTime()).toBe(new Date('2026-11-27T12:53:55.461Z').getTime());

    // 服务表在 schema.sql 里有 5 条种子；搬运只保证源里那一条存在且只有一行
    const [serviceRows] = await admin.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS c FROM agent_services WHERE code = ?',
      ['DH-BOM001'],
    );
    expect(Number(serviceRows[0]!.c)).toBe(1);

    const [linkRows] = await admin.query<mysql.RowDataPacket[]>('SELECT * FROM register_links');
    expect(linkRows).toHaveLength(1);
    expect(Number(linkRows[0]!.use_count)).toBe(2);

    countsAfterFirstRun = await countRows();
  });

  it('重跑幂等：无重复行、计数不变，created_at 始终等于源（不被写入时刻顶替）', async () => {
    // 改源里的展示名再跑一次：name 应更新，created_at 以源为准（不是 NOW）
    writeSource('accounts/agent-services.json', [{ ...services[0]!, name: 'BOM数字人（改名）' }]);
    const output = runMigrate();
    expect(output).toContain('逐列一致');

    expect(await countRows()).toEqual(countsAfterFirstRun);

    const [after] = await admin.query<mysql.RowDataPacket[]>('SELECT name, created_at FROM agent_services WHERE code = ?', [
      'DH-BOM001',
    ]);
    expect(after[0]!.name).toBe('BOM数字人（改名）');
    const createdAt = after[0]!.created_at as Date;
    expect(createdAt.toISOString()).toBe(new Date('2026-11-28T01:00:00.000Z').toISOString());
  });
});
