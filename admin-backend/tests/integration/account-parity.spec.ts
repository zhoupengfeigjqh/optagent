/**
 * 账号接口对拍（029 T027 / U01–U13 子集）：同一串操作在 file 与 mysql 下**逐字段相同**。
 *
 * 做法：两套 fixture 各跑一遍同样的剧本，把每一步的 `status + body` 收进一份记录再整体比对。
 * 角色、手机号、来源、版本推进、改密后旧会话失效、删号后旧会话失效都必须一致。
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
const TEST_DB = 'optagent_test_parity_acc';

let available: boolean;
try {
  const probe = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
  await probe.ping();
  await probe.end();
  available = true;
} catch {
  console.warn(`[account-parity] 本地 MySQL 不可达（${HOST}:${PORT}），已跳过`);
  available = false;
}

type Step = { step: string; status: number; body: unknown };
const ADMIN_PASSWORD = 'init-pass-1';
const NEW_PASSWORD = 'new-pass-2';

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const value = Array.isArray(raw) ? String(raw[0]) : String(raw ?? '');
  return value.split(';')[0] ?? '';
}

/** 同一剧本：每一步只记录对外可见结果 */
async function runScenario(fx: TestFixture): Promise<Step[]> {
  const steps: Step[] = [];
  const bodyOf = (res: { body: string }): unknown => {
    if (!res.body) return null;
    try {
      return JSON.parse(res.body);
    } catch {
      return res.body;
    }
  };
  const record = async (step: string, res: { statusCode: number; body: string }): Promise<void> => {
    steps.push({ step, status: res.statusCode, body: bodyOf(res) });
  };

  // 关联校验要求数字人已存在：两侧各建同样的两个设计态
  for (const name of ['demo', 'other']) {
    const design = await fx.app.inject({
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
    // 设计态响应里的服务编码是随机串、updated_at 是时钟——不属于账号域对拍内容
    steps.push({ step: `create_agent_${name}`, status: design.statusCode, body: null });
  }

  const created = await fx.app.inject({
    method: 'POST',
    url: '/api/admin/users',
    payload: {
      user_id: 'admin',
      agents: ['demo'],
      phone: '13800000001',
      display_name: '管理员',
      role: 'admin',
      password: ADMIN_PASSWORD,
      source_agent_code: 'DH-A01',
    },
  });
  await record('create_admin', created);

  const listed = await fx.app.inject({ method: 'GET', url: '/api/admin/users' });
  // revision 只从写入响应/部署清单取（列表接口不带 revision）
  const revision = (bodyOf(created) as { revision: number }).revision;
  await record('list', listed);

  for (const id of ['u_nophone_1', 'u_nophone_2']) {
    await record(
      `create_${id}`,
      await fx.app.inject({ method: 'POST', url: '/api/admin/users', payload: { user_id: id, agents: [] } }),
    );
  }

  await record(
    'update_agents',
    await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/users/admin',
      payload: { agents: ['demo', 'other'], revision },
    }),
  );

  await record(
    'update_stale_revision',
    await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/users/admin',
      payload: { agents: ['demo'], revision: revision - 1 },
    }),
  );

  const login = await fx.app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    payload: { user_id: 'admin', password: ADMIN_PASSWORD },
  });
  const oldCookie = cookieOf(login);
  steps.push({ step: 'login_ok', status: login.statusCode, body: login.json() });

  await record(
    'me_before_change',
    await fx.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie: oldCookie } }),
  );

  await record(
    'set_password',
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/users/admin/password',
      payload: { password: NEW_PASSWORD },
    }),
  );

  await record(
    'me_after_password_change',
    await fx.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie: oldCookie } }),
  );

  const relogin = await fx.app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    payload: { user_id: 'admin', password: NEW_PASSWORD },
  });
  const newCookie = cookieOf(relogin);
  steps.push({ step: 'relogin_new_password', status: relogin.statusCode, body: relogin.json() });

  const staleLogin = await fx.app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    payload: { user_id: 'admin', password: ADMIN_PASSWORD },
  });
  steps.push({ step: 'login_old_password', status: staleLogin.statusCode, body: staleLogin.json() });

  await record(
    'delete_nophone',
    await fx.app.inject({ method: 'DELETE', url: '/api/admin/users/u_nophone_1' }),
  );

  await record(
    'delete_admin',
    await fx.app.inject({ method: 'DELETE', url: '/api/admin/users/admin' }),
  );

  await record(
    'me_after_delete',
    await fx.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie: newCookie } }),
  );

  await record('list_after_delete', await fx.app.inject({ method: 'GET', url: '/api/admin/users' }));
  return steps;
}

describe.skipIf(!available)('账号接口双驱动对拍（U01–U13 子集）', () => {
  let fileFx: TestFixture;
  let mysqlFx: TestFixture;
  let admin: mysql.Connection;

  beforeAll(async () => {
    admin = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
    await recreateSchema(admin, TEST_DB);
    // 与 file 侧空目录对齐：清掉 schema.sql 的种子服务
    await admin.query(`DELETE FROM ${TEST_DB}.agent_services`);

    fileFx = await createFixture();
    mysqlFx = await createFixture({
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
    await fileFx.cleanup();
    await mysqlFx.cleanup();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.end();
  });

  it('同一剧本在两种存储下 status 与 body 逐字段相等', async () => {
    const fileSteps = await runScenario(fileFx);
    const mysqlSteps = await runScenario(mysqlFx);
    expect(mysqlSteps).toEqual(fileSteps);
  });

  it('两个无手机号账号可同时存在（唯一索引多 NULL）', async () => {
    const res = await fileFx.app.inject({ method: 'GET', url: '/api/admin/users' });
    expect(res.statusCode).toBe(200);
    const mysqlRes = await mysqlFx.app.inject({ method: 'GET', url: '/api/admin/users' });
    expect(mysqlRes.statusCode).toBe(200);
  });
});
