/**
 * 集成测试：账号与数字人服务绑定（028 阶段 2/3，file 驱动默认）
 *
 * 覆盖：数字人服务 CRUD → 注册链接（生成/公开校验/撤销）→ 手机号注册（即授权）
 * → 手机号登录 / me 扩展 / my-agents → 申请-审批-关闭三态 → 用户列表扩展与删除级联。
 * mysql 驱动的同链路由 `tests/unit/mysql-stores.spec.ts`（阶段 1）+ 阶段 2 补充用例覆盖。
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

describe('数字人服务目录（§13 agent-services）', () => {
  it('新建 → 列表（含 registered_users）→ 改名/停用 → 删除', async () => {
    await createService();
    const list = await fx.app.inject({ method: 'GET', url: '/api/admin/agent-services' });
    expect(list.statusCode).toBe(200);
    const item = list.json().items.find((s: { code: string }) => s.code === 'DH-TST01');
    expect(item).toMatchObject({
      name: '测试服务',
      platform_agent_name: 'demo',
      status: 'enabled',
      registered_users: 0,
    });

    const update = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/agent-services/DH-TST01',
      payload: { name: '改名服务', status: 'disabled' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({ name: '改名服务', status: 'disabled' });

    // 未被引用 → 可删除
    const remove = await fx.app.inject({ method: 'DELETE', url: '/api/admin/agent-services/DH-TST01' });
    expect(remove.statusCode).toBe(204);
  });

  it('编码重复 400；platform_agent_name 不在设计态 400；非法编码 400', async () => {
    await createService();
    const dup = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { code: 'DH-TST01', name: '重复', platform_agent_name: 'demo' },
    });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error.code).toBe('VALIDATION_FAILED');

    const badAgent = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { code: 'DH-TST02', name: '幽灵', platform_agent_name: 'ghost' },
    });
    expect(badAgent.statusCode).toBe(400);

    const badCode = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { code: 'bad code!', name: '非法编码', platform_agent_name: 'demo' },
    });
    expect(badCode.statusCode).toBe(400);
  });
});

describe('专属注册链接（§13 register-links）', () => {
  it('生成 → 公开校验 → 撤销后统一 ADM_INVALID_LINK', async () => {
    await createService();
    const token = await createLink();

    const lookup = await fx.app.inject({
      method: 'GET',
      url: `/api/admin/auth/register-links/${encodeURIComponent(token)}`,
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json()).toMatchObject({
      agent: { code: 'DH-TST01', name: '测试服务' },
      expired: false,
    });

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
  it('注册即授权 → 手机号登录 → me 扩展 → my-agents；重复手机号 409', async () => {
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

    const myAgents = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/auth/my-agents',
      headers: { cookie },
    });
    expect(myAgents.statusCode).toBe(200);
    expect(myAgents.json().items).toContainEqual({
      code: 'DH-TST01',
      name: '测试服务',
      platform_agent_name: 'demo',
      status: 'approved',
    });

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

describe('授权三态（§13 grants）', () => {
  it('申请 pending → 审批 approved → 关闭 revoked；未登录申请 401', async () => {
    await createService('DH-TST01');
    await createService('DH-TST02', '第二服务');
    const { userId, cookie } = await registerAndLogin('13900000001');

    // 未登录 → 401
    const anonymous = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/grants/apply',
      payload: { agent_code: 'DH-TST02' },
    });
    expect(anonymous.statusCode).toBe(401);

    // 申请 → pending
    const apply = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/grants/apply',
      headers: { cookie },
      payload: { agent_code: 'DH-TST02' },
    });
    expect(apply.statusCode).toBe(200);
    expect(apply.json()).toMatchObject({ user_id: userId, agent_code: 'DH-TST02', status: 'pending' });

    // 总账（pending 过滤）
    const pendingList = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/grants?status=pending&phone=13900000001',
    });
    expect(pendingList.statusCode).toBe(200);
    expect(pendingList.json().total).toBe(1);
    expect(pendingList.json().items[0]).toMatchObject({
      user_id: userId,
      agent_code: 'DH-TST02',
      status: 'pending',
      source: 'apply',
    });

    // 审批 → approved
    const approve = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/grants/approve',
      payload: { user_id: userId, agent_code: 'DH-TST02' },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().status).toBe('approved');

    const myAgents = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/auth/my-agents',
      headers: { cookie },
    });
    expect(
      myAgents
        .json()
        .items.map((i: { code: string }) => i.code)
        .sort(),
    ).toEqual(['DH-TST01', 'DH-TST02']);

    // 关闭 → revoked（不删行，审计保留）
    const revoke = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/grants/revoke',
      payload: { user_id: userId, agent_code: 'DH-TST02' },
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().status).toBe('revoked');

    const after = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/auth/my-agents',
      headers: { cookie },
    });
    expect(after.json().items.map((i: { code: string }) => i.code)).toEqual(['DH-TST01']);

    const revokedList = await fx.app.inject({ method: 'GET', url: '/api/admin/grants?status=revoked' });
    expect(revokedList.json().total).toBe(1);
  });

  it('审批不存在的授权 → 404 ADM_GRANT_NOT_FOUND', async () => {
    await createService();
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/grants/approve',
      payload: { user_id: 'ghost-user', agent_code: 'DH-TST01' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ADM_GRANT_NOT_FOUND');
  });
});

describe('用户接口扩展（§13 users）', () => {
  it('列表带账号字段与授权摘要；创建可带 phone/role；删除级联清授权', async () => {
    await createService();
    const token = await createLink();
    const { userId } = await registerAndLogin('13700000001', '张三', token);

    // 管理员新建用户（带 phone/role）
    const create = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: { user_id: 'ops2', agents: [], phone: '13600000002', display_name: '运维二号', role: 'user' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({ user_id: 'ops2', phone: '13600000002', role: 'user' });

    // 重复手机号
    const dupPhone = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: { user_id: 'ops3', agents: [], phone: '13600000002' },
    });
    expect(dupPhone.statusCode).toBe(409);
    expect(dupPhone.json().error.code).toBe('ADM_PHONE_TAKEN');

    // 列表扩展字段
    const list = await fx.app.inject({ method: 'GET', url: '/api/admin/users?page=1&expand=summary' });
    expect(list.statusCode).toBe(200);
    const item = list.json().items.find((u: { user_id: string }) => u.user_id === userId);
    expect(item).toMatchObject({
      phone: '13700000001',
      display_name: '张三',
      role: 'user',
      source_agent_code: 'DH-TST01',
      grants_summary: { approved: 1, pending: 0 },
    });

    // 删除用户 → 授权级联清理（file 驱动显式做）
    const remove = await fx.app.inject({ method: 'DELETE', url: `/api/admin/users/${userId}` });
    expect(remove.statusCode).toBe(204);
    const grants = await fx.app.inject({ method: 'GET', url: '/api/admin/grants?agent_code=DH-TST01' });
    expect(grants.json().total).toBe(0);
  });

  it('手机号登录失败不枚举（同码 ADM_INVALID_CREDENTIALS）', async () => {
    const wrongPassword = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { phone: '13000000000', password: 'wrong' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.json().error.code).toBe('ADM_INVALID_CREDENTIALS');
  });
});
