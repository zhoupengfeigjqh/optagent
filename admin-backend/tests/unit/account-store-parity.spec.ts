/**
 * 双驱动终态一致（029 T015）：`revokeLinksOf` / `incrementUseCount` / 清单顺序。
 *
 * file 用临时目录；mysql 连本地真库（独立测试库，用后即删）。
 * 数据库不可达时**先打印"已跳过"再跳过**，避免"绿但没跑"。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformStore } from '../../src/infra/platform-store.js';
import { MysqlAccountStore } from '../../src/domain/account/mysql-account-store.js';
import { FileAccountStore } from '../../src/domain/account/file-account-store.js';
import type { AccountStorePort, AgentServiceRecord, RegisterLinkRecord } from '../../src/domain/account/account-store.js';
import { MysqlConnection } from '../../src/infra/mysql.js';
import { recreateSchema } from '../helpers/mysql-schema.js';

const HOST = process.env.TEST_MYSQL_HOST ?? '127.0.0.1';
const PORT = Number(process.env.TEST_MYSQL_PORT ?? 3306);
const USER = process.env.TEST_MYSQL_USER ?? 'root';
const PASSWORD = process.env.TEST_MYSQL_PASSWORD ?? '123456';
/** 每个真库用例文件独占一个测试库：vitest 并行跑文件，共用 `optagent_test` 会互相 drop */
const TEST_DB = 'optagent_test_parity';

const STAMP = '2026-11-28 10:00:00.000';

const service = (code: string): AgentServiceRecord => ({
  code,
  name: `服务 ${code}`,
  platform_agent_name: `数字人 ${code}`,
  status: 'enabled',
  created_at: STAMP,
  updated_at: STAMP,
});

const link = (token: string, agentCode: string, createdAt: string): RegisterLinkRecord => ({
  token,
  agent_code: agentCode,
  created_by: null,
  expires_at: null,
  revoked_at: null,
  use_count: 0,
  created_at: createdAt,
});

/** 同一组操作在任一实现上都应得到同一终态 */
async function scenario(store: AccountStorePort) {
  await store.insertAgentService(service('DH-AAA01'));
  await store.saveRegisterLink(link('tok-a1', 'DH-AAA01', '2026-11-28 09:00:00.000'));
  await store.saveRegisterLink(link('tok-a2', 'DH-AAA01', '2026-11-28 09:01:00.000'));
  await store.saveRegisterLink(link('tok-b1', 'DH-BBB02', '2026-11-28 09:02:00.000'));

  const revoked = await store.revokeLinksOf(['DH-AAA01'], STAMP);
  const revokedAgain = await store.revokeLinksOf(['DH-AAA01'], STAMP);

  await store.incrementUseCount('tok-a1');
  await store.incrementUseCount('tok-a1');
  await store.incrementUseCount('tok-b1');

  const links = await store.listRegisterLinks();
  return {
    revoked,
    revokedAgain,
    order: links.map((item) => item.token),
    revokedAt: links.filter((item) => item.agent_code === 'DH-AAA01').map((item) => item.revoked_at),
    useCounts: links.map((item) => item.use_count),
  };
}

/** token 是凭据：两种驱动都必须大小写敏感（`_ai_ci` 会让大小写变体命中同一条链接） */
async function tokenCaseProbe(store: AccountStorePort) {
  await store.saveRegisterLink(link('AbCdEf12', 'DH-BBB02', '2026-11-28 09:10:00.000'));
  return {
    exact: (await store.findRegisterLink('AbCdEf12'))?.token ?? null,
    lower: await store.findRegisterLink('abcdef12'),
    upper: await store.findRegisterLink('ABCDEF12'),
  };
}

let available: boolean;
try {
  const probe = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
  await probe.ping();
  await probe.end();
  available = true;
} catch {
  console.warn(`[account-store-parity] 本地 MySQL 不可达（${HOST}:${PORT}），已跳过真实库用例`);
  available = false;
}

describe('账号域存储端口：file 实现', () => {
  let root: string;
  let store: FileAccountStore;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-file-'));
    const platform = new PlatformStore(root);
    platform.ensureLayout();
    store = new FileAccountStore(platform);
    await store.init();
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('撤销/计数/顺序的终态符合预期', async () => {
    const result = await scenario(store);
    expect(result.revoked).toBe(2);
    expect(result.revokedAgain).toBe(0);
    expect(result.order).toEqual(['tok-a1', 'tok-a2', 'tok-b1']);
    expect(result.revokedAt).toEqual([STAMP, STAMP]);
    expect(result.useCounts).toEqual([2, 0, 1]);
  });

  it('token 区分大小写：只有完全一致才命中', async () => {
    const probe = await tokenCaseProbe(store);
    expect(probe.exact).toBe('AbCdEf12');
    expect(probe.lower).toBeNull();
    expect(probe.upper).toBeNull();
  });
});

describe.skipIf(!available)('账号域存储端口：mysql 实现（真库）', () => {
  let conn: MysqlConnection;
  let admin: mysql.Connection;
  let store: MysqlAccountStore;

  beforeAll(async () => {
    admin = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
    await recreateSchema(admin, TEST_DB);
    conn = new MysqlConnection({
      host: HOST, port: PORT, user: USER, password: PASSWORD, database: TEST_DB, poolSize: 2, logger: undefined,
    });
    store = new MysqlAccountStore(conn);
    await store.init();
  });

  afterAll(async () => {
    await conn.close();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.end();
  });

  it('与 file 实现终态一致', async () => {
    const result = await scenario(store);
    expect(result.revoked).toBe(2);
    expect(result.revokedAgain).toBe(0);
    expect(result.order).toEqual(['tok-a1', 'tok-a2', 'tok-b1']);
    expect(result.revokedAt).toEqual([STAMP, STAMP]);
    expect(result.useCounts).toEqual([2, 0, 1]);
  });

  it('token 区分大小写：与 file 实现同结论', async () => {
    const probe = await tokenCaseProbe(store);
    expect(probe.exact).toBe('AbCdEf12');
    expect(probe.lower).toBeNull();
    expect(probe.upper).toBeNull();
  });
});
