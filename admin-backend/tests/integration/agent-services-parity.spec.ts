/**
 * 数字人与服务编码（029 T040 / FR-018–FR-021，数据库模式 + 真库）。
 *
 * 覆盖删除判定的唯一口径（有效链接或用户关联都算"还占着"）与级联撤销，
 * 以及"自动生成编码不撞码"。
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
const TEST_DB = 'optagent_test_services';

let available: boolean;
try {
  const probe = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
  await probe.ping();
  await probe.end();
  available = true;
} catch {
  console.warn(`[agent-services-parity] 本地 MySQL 不可达（${HOST}:${PORT}），已跳过`);
  available = false;
}

function design(name: string) {
  return {
    name,
    soul: soulDesign(`# ${name}\n你是助手`),
    enabled_tools: [],
    mcp_services: [],
    skills: [],
    scenario: { scenario: '生产', data_prep_dirs: [] },
  };
}

describe.skipIf(!available)('数字人服务编码与删除判定（真库）', () => {
  let fx: TestFixture;
  let admin: mysql.Connection;

  beforeAll(async () => {
    admin = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
    await recreateSchema(admin, TEST_DB);
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
    // 服务只能挂到已存在的平台数字人上
    for (const name of ['auto_a', 'auto_b', 'dup', 'del_a', 'del_b']) {
      const created = await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: design(name) });
      expect(created.statusCode, `建设计态失败 ${name}：${created.body}`).toBe(201);
    }
  });

  afterAll(async () => {
    await fx.cleanup();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.end();
  });

  it('省略编码自动生成，且多条互不撞码', async () => {
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { name: '自动编码一', platform_agent_name: 'auto_a' },
    });
    expect(created.statusCode).toBe(201);
    const code = (created.json() as { code: string }).code;
    expect(code).toMatch(/^DH-[A-Z0-9]{5}$/);

    const second = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { name: '自动编码二', platform_agent_name: 'auto_b' },
    });
    expect((second.json() as { code: string }).code).not.toBe(code);
  });

  it('指定编码重复 → 400 且不覆盖既有服务', async () => {
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { code: 'DH-DUP01', name: '原始名称', platform_agent_name: 'dup' },
    });
    const dup = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { code: 'DH-DUP01', name: '冒名顶替', platform_agent_name: 'dup' },
    });
    expect(dup.statusCode).toBe(400);

    const listed = await fx.app.inject({ method: 'GET', url: '/api/admin/agent-services' });
    const item = (listed.json() as { items: Array<{ code: string; name: string }> }).items.find(
      (row) => row.code === 'DH-DUP01',
    );
    expect(item?.name).toBe('原始名称');
  });

  it('有有效链接 → 拒绝删除服务；链接全部撤销后 → 可删', async () => {
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { code: 'DH-DEL01', name: '待删服务', platform_agent_name: 'del_a' },
    });
    const link = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/register-links',
      payload: { agent_code: 'DH-DEL01' },
    });
    const token = (link.json() as { token: string }).token;

    const blocked = await fx.app.inject({ method: 'DELETE', url: '/api/admin/agent-services/DH-DEL01' });
    expect(blocked.statusCode).toBeGreaterThanOrEqual(400);

    await fx.app.inject({ method: 'DELETE', url: `/api/admin/register-links/${encodeURIComponent(token)}` });
    const allowed = await fx.app.inject({ method: 'DELETE', url: '/api/admin/agent-services/DH-DEL01' });
    expect(allowed.statusCode).toBe(204);
  });

  it('有账号关联 → 拒绝删除服务', async () => {
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { code: 'DH-DEL02', name: '被关联服务', platform_agent_name: 'del_b' },
    });
    await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: design('del_b') });
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: { user_id: 'u_holder', agents: ['del_b'] },
    });

    const blocked = await fx.app.inject({ method: 'DELETE', url: '/api/admin/agent-services/DH-DEL02' });
    expect(blocked.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('删除数字人：历史链接被撤销，服务记录一并移除', async () => {
    await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: design('cascade') });
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { code: 'DH-CAS01', name: '级联服务', platform_agent_name: 'cascade' },
    });
    const link = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/register-links',
      payload: { agent_code: 'DH-CAS01' },
    });
    const token = (link.json() as { token: string }).token;

    const removed = await fx.app.inject({ method: 'DELETE', url: '/api/admin/agents/cascade' });
    expect(removed.statusCode).toBe(204);

    const [links] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT revoked_at FROM ${TEST_DB}.register_links WHERE token = ?`,
      [token],
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.revoked_at).not.toBeNull();

    const [services] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM ${TEST_DB}.agent_services WHERE platform_agent_name = ?`,
      ['cascade'],
    );
    expect(Number(services[0]!.c)).toBe(0);

    // 历史链接仍在清单里（台账不因数字人消失而抹除）
    const listed = await fx.app.inject({ method: 'GET', url: '/api/admin/register-links' });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { items: Array<{ token: string }> }).items.some((row) => row.token === token)).toBe(true);
  });
});
