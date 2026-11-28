/**
 * 存储不可用（029 T045 / T047 / FR-022）。
 *
 * 两件事：①运行期库没了 → 响应是可读的 `ADM_STORAGE_UNAVAILABLE`（不出现裸 `ER_`）；
 * ②启动期连不上 → 进程以非零码退出并给出照做提示。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';
import { recreateSchema } from '../helpers/mysql-schema.js';

const HOST = process.env.TEST_MYSQL_HOST ?? '127.0.0.1';
const PORT = Number(process.env.TEST_MYSQL_PORT ?? 3306);
const USER = process.env.TEST_MYSQL_USER ?? 'root';
const PASSWORD = process.env.TEST_MYSQL_PASSWORD ?? '123456';
const TEST_DB = 'optagent_test_unavailable';
const PROJECT_ROOT = path.resolve(process.cwd());

let available: boolean;
try {
  const probe = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
  await probe.ping();
  await probe.end();
  available = true;
} catch {
  console.warn(`[mysql-unavailable] 本地 MySQL 不可达（${HOST}:${PORT}），已跳过`);
  available = false;
}

describe.skipIf(!available)('运行期库不可用（真库）', () => {
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

  it('库被删掉后写接口返回可读错误（不含裸 ER_）', async () => {
    await admin.query(`DROP DATABASE ${TEST_DB}`);
    // 读走内存投影（启动期全量加载），故用写入路径触发真实 SQL 失败
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: { user_id: 'u_after_drop', agents: [] },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('ADM_STORAGE_UNAVAILABLE');
    expect(body.error.message).not.toMatch(/ER_/);
    expect(body.error.message.length).toBeGreaterThan(4);
  });

  it('健康检查同时标记数据库不可达，但 HTTP 仍 200', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/platform/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { database?: { reachable: boolean; error: string | null } };
    expect(body.database?.reachable).toBe(false);
    expect(body.database?.error).toBeTruthy();
  });
});

describe('启动期连不上库（T047）', () => {
  it('进程以非零码退出，并给出「三步」提示', () => {
    let output = '';
    let status = 0;
    try {
      execFileSync(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          STORAGE_DRIVER: 'mysql',
          MYSQL_HOST: '127.0.0.1',
          MYSQL_PORT: '1',
          MYSQL_USER: 'root',
          MYSQL_PASSWORD: 'x',
          MYSQL_DATABASE: 'optagent_missing',
          PORT: '3987',
          AUTH_SECRET: 'test-secret-for-startup-32chars',
          PLATFORM_DATA_DIR: path.join(PROJECT_ROOT, '.platform-data'),
          OPT_AGENT_ROOT: path.join(PROJECT_ROOT, '..', 'agent-backend', '.opt-agent'),
        },
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 30_000,
      });
    } catch (err) {
      const failure = err as { status?: number; stdout?: string; stderr?: string };
      status = failure.status ?? 1;
      output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    }
    expect(status).not.toBe(0);
    expect(output).toContain('启动失败');
    expect(output).toContain('npm run db:up');
    expect(output).not.toMatch(/ER_/);
  });
});
