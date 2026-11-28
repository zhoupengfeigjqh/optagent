/**
 * 注册链路（029 T035 子集，数据库模式走真实 HTTP 与真库）。
 *
 * 断言与 file 模式同口径：成功建号 + 自动关联 + 不自动登录 + 计数 +1；
 * 手机号重复 409；撤销 / 停用 / 不存在链接统一 `ADM_INVALID_LINK`；
 * 同一条链接并发注册，计数准确累计。
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
const TEST_DB = 'optagent_test_register';

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
  console.warn(`[register-parity] 本地 MySQL 不可达（${HOST}:${PORT}），已跳过`);
  available = false;
}

let phoneSeq = 0;
function nextPhone(): string {
  phoneSeq += 1;
  return `139${String(phoneSeq).padStart(8, '0')}`;
}

describe.skipIf(!available)('注册链路（数据库模式）', () => {
  let fx: TestFixture;
  let admin: mysql.Connection;

  async function createService(code = 'DH-REG01', status = 'enabled'): Promise<void> {
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { code, name: '测试服务', platform_agent_name: 'demo' },
    });
    expect(created.statusCode).toBe(201);
    if (status === 'disabled') {
      const updated = await fx.app.inject({
        method: 'PUT',
        url: `/api/admin/agent-services/${code}`,
        payload: { status: 'disabled' },
      });
      expect(updated.statusCode).toBe(200);
    }
  }

  async function createLink(agentCode = 'DH-REG01'): Promise<string> {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/register-links',
      payload: { agent_code: agentCode },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { token: string }).token;
  }

  beforeAll(async () => {
    admin = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
    await recreateSchema(admin, TEST_DB);
    // 与 file 模式的空目录对齐：清掉 schema.sql 的种子服务
    await admin.query('USE ??', [TEST_DB]);
    await admin.query(`DELETE FROM ${TEST_DB}.agent_services`);
    await admin.query(`DELETE FROM ${TEST_DB}.register_links`);

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
    await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: AGENT });
    await createService();
  });

  afterAll(async () => {
    await fx.cleanup();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.end();
  });

  it('成功注册：自动关联、不自动登录、计数 +1', async () => {
    const token = await createLink();
    const phone = nextPhone();
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/register',
      payload: { link_token: token, phone, display_name: '张三', password: '123456' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect((res.json() as { granted_agent: { name: string } }).granted_agent.name).toBe('测试服务');

    const links = await fx.app.inject({ method: 'GET', url: '/api/admin/register-links' });
    const used = (links.json() as { items: Array<{ token: string; use_count: number }> }).items.find(
      (item) => item.token === token,
    );
    expect(used?.use_count).toBe(1);

    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT agents, phone FROM ${TEST_DB}.users WHERE phone = ?`,
      [phone],
    );
    expect(rows).toHaveLength(1);
    const agents = typeof rows[0]!.agents === 'string' ? JSON.parse(rows[0]!.agents as string) : rows[0]!.agents;
    expect(agents).toContain('demo');
  });

  it('手机号重复 → 409 ADM_PHONE_TAKEN', async () => {
    const token = await createLink();
    const phone = nextPhone();
    const first = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/register',
      payload: { link_token: token, phone, display_name: '李四', password: '123456' },
    });
    expect(first.statusCode).toBe(201);

    const dup = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/register',
      payload: { link_token: token, phone, display_name: '李四', password: '123456' },
    });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { error: { code: string } }).error.code).toBe('ADM_PHONE_TAKEN');
  });

  it('已撤销链接 → 400 ADM_INVALID_LINK', async () => {
    const token = await createLink();
    const revoke = await fx.app.inject({
      method: 'DELETE',
      url: `/api/admin/register-links/${encodeURIComponent(token)}`,
    });
    expect(revoke.statusCode).toBe(204);

    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/register',
      payload: { link_token: token, phone: nextPhone(), display_name: '王五', password: '123456' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ADM_INVALID_LINK');
  });

  it('服务停用 → 生成链接被拒，既有链接注册返回同一 ADM_INVALID_LINK', async () => {
    await createService('DH-REG02', 'enabled');
    const token = await createLink('DH-REG02');
    const disable = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/agent-services/DH-REG02',
      payload: { status: 'disabled' },
    });
    expect(disable.statusCode).toBe(200);

    const generate = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/register-links',
      payload: { agent_code: 'DH-REG02' },
    });
    expect(generate.statusCode).toBe(400);

    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/register',
      payload: { link_token: token, phone: nextPhone(), display_name: '赵六', password: '123456' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ADM_INVALID_LINK');
  });

  it('已过期链接 → 400 ADM_INVALID_LINK', async () => {
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/register-links',
      payload: { agent_code: 'DH-REG01', expires_in_seconds: 1 },
    });
    expect(created.statusCode).toBe(201);
    const token = (created.json() as { token: string }).token;
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/register',
      payload: { link_token: token, phone: nextPhone(), display_name: '过期用户', password: '123456' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ADM_INVALID_LINK');
  });

  it('过期后再撤销 → 仍是同一个 ADM_INVALID_LINK', async () => {
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/register-links',
      payload: { agent_code: 'DH-REG01', expires_in_seconds: 1 },
    });
    const token = (created.json() as { token: string }).token;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const revoke = await fx.app.inject({
      method: 'DELETE',
      url: `/api/admin/register-links/${encodeURIComponent(token)}`,
    });
    expect(revoke.statusCode).toBe(204);

    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/register',
      payload: { link_token: token, phone: nextPhone(), display_name: '过期又撤销', password: '123456' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ADM_INVALID_LINK');
  });

  it('并发同手机号注册：只有一条成功，另一条 409 ADM_PHONE_TAKEN', async () => {
    const [tokenA, tokenB] = await Promise.all([createLink(), createLink()]);
    const phone = nextPhone();
    const results = await Promise.all(
      [tokenA, tokenB].map((token) =>
        fx.app.inject({
          method: 'POST',
          url: '/api/admin/auth/register',
          payload: { link_token: token, phone, display_name: '同号并发', password: '123456' },
        }),
      ),
    );
    const statuses = results.map((res) => res.statusCode).sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = results.find((res) => res.statusCode === 409)!;
    expect((conflict.json() as { error: { code: string } }).error.code).toBe('ADM_PHONE_TAKEN');

    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM ${TEST_DB}.users WHERE phone = ?`,
      [phone],
    );
    expect(Number(rows[0]!.c)).toBe(1);
  });

  it('同一链接并发注册：两条都成功，计数准确 +2', async () => {
    const token = await createLink();
    const results = await Promise.all(
      [nextPhone(), nextPhone()].map((phone) =>
        fx.app.inject({
          method: 'POST',
          url: '/api/admin/auth/register',
          payload: { link_token: token, phone, display_name: '并发用户', password: '123456' },
        }),
      ),
    );
    expect(results.map((res) => res.statusCode)).toEqual([201, 201]);

    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT use_count FROM ${TEST_DB}.register_links WHERE token = ?`,
      [token],
    );
    expect(Number(rows[0]!.use_count)).toBe(2);
  });
});
