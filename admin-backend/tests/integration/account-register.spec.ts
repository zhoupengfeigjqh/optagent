/**
 * 集成测试：注册链接与手机号注册（028 阶段 2/3，file 驱动默认）
 *
 * 由 account.spec.ts 拆出（原则二：单文件 ≤500 行）。数字人服务目录、用户接口扩展、
 * 数字人 ⇔ 服务编码 1:1 仍在原文件。
 *
 * 覆盖：专属注册链接（生成/公开校验/撤销）→ 手机号注册（即授权）→ 手机号登录 / me 扩展 / my-agents。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';
import { soulDesign } from '../helpers/soul.js';

let fx: TestFixture;

const AGENT = {
  name: 'demo',
  soul: soulDesign('# 生产计划助手\n你是助手'),
  enabled_tools: ['read_file'],
  mcp_services: ['ocr'],
  skills: [],
  scenario: { scenario: '生产', data_prep_dirs: ['生产计划', '算法规则'] },
};

beforeEach(async () => {
  fx = await createFixture({ userIds: ['admin'], mcpServices: { ocr: {} } });
  fx.runtime.tools = [
    {
      name: 'read_file',
      label: '读取文件',
      description_template: 'x',
      parameters: { type: 'object' },
      writable: false,
    },
  ];
  await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: AGENT });
});

afterEach(async () => {
  await fx.cleanup();
});

/** 建一个数字人服务（默认指向设计态 demo） */
async function createService(code = 'DH-TST01', name = '测试服务'): Promise<void> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/admin/agent-services',
    payload: { code, name, platform_agent_name: 'demo' },
  });
  expect(res.statusCode).toBe(201);
}

/** 生成注册链接并返回 token */
async function createLink(agentCode = 'DH-TST01'): Promise<string> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/admin/register-links',
    payload: { agent_code: agentCode },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { token: string; url: string };
  expect(body.url).toBe(`/register?link=${encodeURIComponent(body.token)}`);
  return body.token;
}

/** 注册一个用户并返回 { user_id, token }（token = 登录 Cookie） */
async function registerAndLogin(
  phone: string,
  displayName = '张三',
  linkToken: string | undefined = undefined,
): Promise<{ userId: string; cookie: string }> {
  const token = linkToken ?? (await createLink());
  const register = await fx.app.inject({
    method: 'POST',
    url: '/api/admin/auth/register',
    payload: { link_token: token, phone, display_name: displayName, password: '123456' },
  });
  expect(register.statusCode).toBe(201);
  const userId = register.json().user_id as string;
  const login = await fx.app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    payload: { phone, password: '123456' },
  });
  expect(login.statusCode).toBe(200);
  const cookie = (login.headers['set-cookie'] as string).split(';')[0] ?? '';
  return { userId, cookie };
}

describe('专属注册链接（§13 register-links）', () => {
  it('生成 → 公开校验 → 撤销后统一 ADM_INVALID_LINK', async () => {
    await createService();
    const token = await createLink();

    const lookup = await fx.app.inject({
      method: 'GET',
      url: `/api/admin/auth/register-links/${encodeURIComponent(token)}`,
    });
    expect(lookup.statusCode).toBe(200);
    // 2026-11-27：不再回 `expired`（无效/过期/撤销/停用统一 ADM_INVALID_LINK，不枚举）
    expect(lookup.json()).toEqual({ agent: { code: 'DH-TST01', name: '测试服务' } });

    const revoke = await fx.app.inject({
      method: 'DELETE',
      url: `/api/admin/register-links/${encodeURIComponent(token)}`,
    });
    expect(revoke.statusCode).toBe(204);

    const afterRevoke = await fx.app.inject({
      method: 'GET',
      url: `/api/admin/auth/register-links/${encodeURIComponent(token)}`,
    });
    expect(afterRevoke.statusCode).toBe(400);
    expect(afterRevoke.json().error.code).toBe('ADM_INVALID_LINK');
  });

  it('服务不存在 → 404；停用服务不可生成链接', async () => {
    const missing = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/register-links',
      payload: { agent_code: 'DH-NOPE1' },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('ADM_AGENT_SERVICE_NOT_FOUND');

    await createService();
    await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/agent-services/DH-TST01',
      payload: { status: 'disabled' },
    });
    const disabled = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/register-links',
      payload: { agent_code: 'DH-TST01' },
    });
    expect(disabled.statusCode).toBe(400);
  });
});

describe('手机号注册与登录（§13 register / login 扩展）', () => {
  it('注册即关联（写 users.agents）→ 登录 → me 扩展；未部署不下发 my-agents', async () => {
    await createService();
    const token = await createLink();
    const { userId, cookie } = await registerAndLogin('13800000001', '张三', token);

    expect(userId).toMatch(/^u_[0-9a-f]{12}$/);

    const me = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/auth/me',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user_id: userId,
      phone: '13800000001',
      display_name: '张三',
      role: 'user',
    });

    // 授权 = 关联：注册即写 users.agents（部署区因此能看到可部署内容）
    const list = await fx.app.inject({ method: 'GET', url: '/api/admin/users?page=1' });
    const created = list.json().items.find((u: { user_id: string }) => u.user_id === userId);
    expect(created.agents.map((a: { name: string }) => a.name)).toContain('demo');

    // 但工作台切换列表要求"已部署"——未部署前不下发（部署是唯一生效闸门）
    const myAgents = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/auth/my-agents',
      headers: { cookie },
    });
    expect(myAgents.statusCode).toBe(200);
    expect(myAgents.json().items).toEqual([]);

    // 重复手机号
    const dup = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/register',
      payload: {
        link_token: await createLink(),
        phone: '13800000001',
        display_name: '李四',
        password: '123456',
      },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('ADM_PHONE_TAKEN');

    // 注册链接计数
    const links = await fx.app.inject({ method: 'GET', url: '/api/admin/register-links' });
    const used = links.json().items.find((l: { token: string }) => l.token === token);
    expect(used?.use_count).toBe(1);
  });

  it('部署后才下发 my-agents（授权 ∩ 已部署）', async () => {
    await createService();
    const { userId, cookie } = await registerAndLogin('13800000009', '赵六');

    const before = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/auth/my-agents',
      headers: { cookie },
    });
    expect(before.json().items).toEqual([]);

    const manifest = await fx.app.inject({ method: 'GET', url: '/api/admin/deploy/manifest' });
    const revision = (manifest.json() as { revision: number }).revision;
    const deploy = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: [userId], revision },
    });
    expect(deploy.statusCode).toBe(200);

    const after = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/auth/my-agents',
      headers: { cookie },
    });
    expect(after.json().items).toEqual([
      { code: 'DH-TST01', name: '测试服务', platform_agent_name: 'demo', status: 'approved' },
    ]);
    expect(after.json().pending).toEqual([]);
  });

  it('无效链接注册 → ADM_INVALID_LINK；注册不自动登录（无 Cookie）', async () => {
    await createService();
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/register',
      payload: {
        link_token: 'not-a-real-token',
        phone: '13800000002',
        display_name: '王五',
        password: '123456',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ADM_INVALID_LINK');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
