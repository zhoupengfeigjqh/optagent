/**
 * 健康检查反映账号存储（029 T049 / FR-023 / D-4）。
 *
 * 文件模式响应**不含** `database`；数据库模式含 `{reachable,host,database,error}` 四字段；
 * 库不可达时 `reachable=false`、`error≠null`，HTTP 仍为 200。
 */
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';
import { probeMysql } from '../../src/infra/mysql.js';
import { recreateSchema } from '../helpers/mysql-schema.js';

const HOST = process.env.TEST_MYSQL_HOST ?? '127.0.0.1';
const PORT = Number(process.env.TEST_MYSQL_PORT ?? 3306);
const USER = process.env.TEST_MYSQL_USER ?? 'root';
const PASSWORD = process.env.TEST_MYSQL_PASSWORD ?? '123456';
const TEST_DB = 'optagent_test_health';

let available: boolean;
try {
  const probe = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
  await probe.ping();
  await probe.end();
  available = true;
} catch {
  console.warn(`[platform-health] 本地 MySQL 不可达（${HOST}:${PORT}），已跳过数据库模式用例`);
  available = false;
}

describe('健康检查（文件模式）', () => {
  let fx: TestFixture;

  beforeAll(async () => {
    fx = await createFixture();
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('响应不含 database 字段', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/platform/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.platform_data).toBeDefined();
    expect(body.opt_agent).toBeDefined();
    expect(body).not.toHaveProperty('database');
  });
});

describe.skipIf(!available)('健康检查（数据库模式，真库）', () => {
  let fx: TestFixture;
  let admin: mysql.Connection;

  beforeAll(async () => {
    admin = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
    await recreateSchema(admin, TEST_DB);
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
  });

  afterAll(async () => {
    await fx.cleanup();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.end();
  });

  it('包含 database 四字段且可达', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/platform/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { database?: Record<string, unknown> };
    expect(body.database).toMatchObject({ reachable: true, host: HOST, database: TEST_DB, error: null });
  });

  it('库不可达：探测返回 reachable=false 且带可读错误（不抛异常）', async () => {
    const result = await probeMysql(
      { host: '127.0.0.1', port: 1, user: USER, password: PASSWORD, database: TEST_DB },
      500,
    );
    expect(result.reachable).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).not.toMatch(/^ERR_/);
  });
});
