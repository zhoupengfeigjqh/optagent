/**
 * 改授权后旧版本部署被拒（029 T028 / FR-011，数据库模式 + 真库）。
 *
 * 断言三件事：改授权推进版本、旧版本部署 409、被拒时运行环境**零写入**。
 */
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture, snapshotTree, type TestFixture } from '../helpers/fixture.js';
import { soulDesign } from '../helpers/soul.js';
import { recreateSchema } from '../helpers/mysql-schema.js';

const HOST = process.env.TEST_MYSQL_HOST ?? '127.0.0.1';
const PORT = Number(process.env.TEST_MYSQL_PORT ?? 3306);
const USER = process.env.TEST_MYSQL_USER ?? 'root';
const PASSWORD = process.env.TEST_MYSQL_PASSWORD ?? '123456';
const TEST_DB = 'optagent_test_revconflict';

const AGENT = {
  name: 'demo',
  soul: soulDesign('# 生产计划助手\n你是助手'),
  enabled_tools: [],
  mcp_services: [],
  skills: [],
  scenario: { scenario: '生产', data_prep_dirs: [] },
};

let available: boolean;
try {
  const probe = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
  await probe.ping();
  await probe.end();
  available = true;
} catch {
  console.warn(`[revision-deploy-conflict] 本地 MySQL 不可达（${HOST}:${PORT}），已跳过`);
  available = false;
}

describe.skipIf(!available)('改授权 → 旧版本部署 409（真库）', () => {
  let fx: TestFixture;
  let admin: mysql.Connection;
  let currentRevision = 0;

  beforeAll(async () => {
    admin = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
    await recreateSchema(admin, TEST_DB);
    await admin.query(`DELETE FROM ${TEST_DB}.agent_services`);

    fx = await createFixture({
      userIds: ['admin'],
      env: {
        STORAGE_DRIVER: 'mysql',
        MYSQL_HOST: HOST,
        MYSQL_PORT: String(PORT),
        MYSQL_USER: USER,
        MYSQL_PASSWORD: PASSWORD,
        MYSQL_DATABASE: TEST_DB,
      },
    });
    const design = await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: AGENT });
    expect(design.statusCode, `建数字人失败：${design.body}`).toBe(201);
    const user = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: { user_id: 'admin', agents: ['demo'], display_name: '管理员', role: 'admin' },
    });
    expect(user.statusCode, `建账号失败：${user.body}`).toBe(201);
    currentRevision = (user.json() as { revision: number }).revision;
  });

  afterAll(async () => {
    await fx.cleanup();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.end();
  });

  it('改授权推进版本，旧版本部署被拒且运行环境零写入', async () => {
    const staleRevision = currentRevision;
    const before = snapshotTree(fx.optAgentRoot);

    const updated = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/users/admin',
      payload: { agents: ['demo'], revision: staleRevision },
    });
    expect(updated.statusCode, `改授权失败：${updated.body}`).toBe(200);
    expect((updated.json() as { revision: number }).revision).toBe(staleRevision + 1);

    const rejected = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: staleRevision },
    });
    expect(rejected.statusCode).toBe(409);
    expect((rejected.json() as { error: { code: string } }).error.code).toBe(
      'ADM_CONFIG_REVISION_CONFLICT',
    );
    expect(snapshotTree(fx.optAgentRoot)).toEqual(before);

    const accepted = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: staleRevision + 1 },
    });
    expect(accepted.statusCode).toBe(200);
    expect(fs.existsSync(fx.optAgentRoot)).toBe(true);
  });
});
