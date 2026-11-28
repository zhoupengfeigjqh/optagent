/**
 * 删号链路失败（029 T029 / FR-013，数据库模式 + 真库）。
 *
 * 撤回能力失败时：账号**仍在**、错误如实返回、不出现"一半成功"。
 */
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';
import { recreateSchema } from '../helpers/mysql-schema.js';

const HOST = process.env.TEST_MYSQL_HOST ?? '127.0.0.1';
const PORT = Number(process.env.TEST_MYSQL_PORT ?? 3306);
const USER = process.env.TEST_MYSQL_USER ?? 'root';
const PASSWORD = process.env.TEST_MYSQL_PASSWORD ?? '123456';
const TEST_DB = 'optagent_test_deletefail';

let available: boolean;
try {
  const probe = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
  await probe.ping();
  await probe.end();
  available = true;
} catch {
  console.warn(`[users-delete-failure] 本地 MySQL 不可达（${HOST}:${PORT}），已跳过`);
  available = false;
}

describe.skipIf(!available)('删号链路失败（真库）', () => {
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
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: { user_id: 'u_keep', agents: [], display_name: '待删' },
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await fx.cleanup();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.end();
  });

  it('撤回能力失败 → 返回错误，账号仍在库里', async () => {
    const purge = vi
      .spyOn(fx.ctx.deployer, 'purgeUser')
      .mockImplementation(() => {
        throw new Error('运行环境目录不可写');
      });

    const res = await fx.app.inject({ method: 'DELETE', url: '/api/admin/users/u_keep' });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(purge).toHaveBeenCalledWith('u_keep');

    const listed = await fx.app.inject({ method: 'GET', url: '/api/admin/users' });
    const items = (listed.json() as { items: Array<{ user_id: string }> }).items;
    expect(items.map((item) => item.user_id)).toContain('u_keep');

    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM ${TEST_DB}.users WHERE user_id = ?`,
      ['u_keep'],
    );
    expect(Number(rows[0]!.c)).toBe(1);
  });

  it('撤回成功后重试 → 204，记录消失', async () => {
    vi.restoreAllMocks();
    const res = await fx.app.inject({ method: 'DELETE', url: '/api/admin/users/u_keep' });
    expect(res.statusCode).toBe(204);

    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM ${TEST_DB}.users WHERE user_id = ?`,
      ['u_keep'],
    );
    expect(Number(rows[0]!.c)).toBe(0);
  });
});
