/**
 * 并发约束（029 T044 / FR-016、R3，数据库模式 + 真库）。
 *
 * 只断言"可解释的结果"：并发建同名账号只有一成功（另一条 409），
 * 同版本并发改授权只有一成功（另一条 409），且库里终态是成功那一条。
 */
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';
import { soulDesign } from '../helpers/soul.js';
import { recreateSchema } from '../helpers/mysql-schema.js';

const HOST = process.env.TEST_MYSQL_HOST ?? '127.0.0.1';
const PORT = Number(process.env.TEST_MYSQL_PORT ?? 3306);
const USER = process.env.TEST_MYSQL_USER ?? 'root';
const PASSWORD = process.env.TEST_MYSQL_PASSWORD ?? '123456';
const TEST_DB = 'optagent_test_concurrency';

let available: boolean;
try {
  const probe = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
  await probe.ping();
  await probe.end();
  available = true;
} catch {
  console.warn(`[mysql-concurrency] 本地 MySQL 不可达（${HOST}:${PORT}），已跳过`);
  available = false;
}

describe.skipIf(!available)('并发约束（真库）', () => {
  let fx: TestFixture;
  let admin: mysql.Connection;

  beforeAll(async () => {
    admin = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
    await recreateSchema(admin, TEST_DB);
    await admin.query(`DELETE FROM ${TEST_DB}.agent_services`);

    fx = await createFixture({
      env: {
        STORAGE_DRIVER: 'mysql',
        MYSQL_HOST: HOST,
        MYSQL_PORT: String(PORT),
        MYSQL_USER: USER,
        MYSQL_PASSWORD: PASSWORD,
        MYSQL_DATABASE: TEST_DB,
      },
    });
    // 改授权要过"数字人必须存在"的校验
    for (const name of ['a', 'b']) {
      await fx.app.inject({
        method: 'POST',
        url: '/api/admin/agents',
        payload: {
          name,
          soul: soulDesign(`# ${name}\n你是助手`),
          enabled_tools: [],
          mcp_services: [],
          skills: [],
          scenario: { scenario: '生产', data_prep_dirs: [] },
        },
      });
    }
  });

  afterAll(async () => {
    await fx.cleanup();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.end();
  });

  it('并发新建同名账号：一条 201、一条 409 ADM_USER_ID_TAKEN', async () => {
    const payload = { user_id: 'u_race', agents: [], display_name: '并发' };
    const results = await Promise.all([
      fx.app.inject({ method: 'POST', url: '/api/admin/users', payload }),
      fx.app.inject({ method: 'POST', url: '/api/admin/users', payload }),
    ]);

    const statuses = results.map((res) => res.statusCode).sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = results.find((res) => res.statusCode === 409)!;
    expect((conflict.json() as { error: { code: string } }).error.code).toBe('ADM_USER_ID_TAKEN');

    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM ${TEST_DB}.users WHERE user_id = ?`,
      ['u_race'],
    );
    expect(Number(rows[0]!.c)).toBe(1);
  });

  it('并发同版本改授权：一条 200、一条 409，且只落一次改动', async () => {
    const manifest = await fx.app.inject({ method: 'GET', url: '/api/admin/deploy/manifest' });
    const revision = (manifest.json() as { revision: number }).revision;

    const results = await Promise.all([
      fx.app.inject({
        method: 'PUT',
        url: '/api/admin/users/u_race',
        payload: { agents: ['a'], revision },
      }),
      fx.app.inject({
        method: 'PUT',
        url: '/api/admin/users/u_race',
        payload: { agents: ['b'], revision },
      }),
    ]);

    const statuses = results.map((res) => res.statusCode).sort();
    expect(statuses).toEqual([200, 409]);

    const winner = results.find((res) => res.statusCode === 200)!;
    const applied = (winner.json() as { agents: string[] }).agents;
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT agents FROM ${TEST_DB}.users WHERE user_id = ?`,
      ['u_race'],
    );
    const stored = typeof rows[0]!.agents === 'string' ? JSON.parse(rows[0]!.agents as string) : rows[0]!.agents;
    expect(stored).toEqual(applied);
  });
});
