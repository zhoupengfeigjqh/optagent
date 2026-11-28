/**
 * 集成测试：账号与数字人服务绑定（028 阶段 2/3，file 驱动默认）
 *
 * 覆盖：数字人服务 CRUD → 用户接口扩展与删除级联 → 数字人 ⇔ 服务编码 1:1。
 * 注册链接与手机号注册/登录链路已拆到 `account-register.spec.ts`（原则二：单文件 ≤500 行）。
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

  it('registered_users 反映真实关联数（创建响应不再恒为 0，2026-11-27）', async () => {
    await fx.ctx.users.create('u_rel', ['demo']);
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { name: '测试服务', platform_agent_name: 'demo' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().registered_users).toBe(1);
    // 与列表口径一致
    const list = await fx.app.inject({ method: 'GET', url: '/api/admin/agent-services' });
    expect(list.json().items[0].registered_users).toBe(1);
  });

  it('已撤销链接不算 in-use：删除服务不被历史链接阻断（2026-11-27）', async () => {
    await createService('DH-TST09');
    const link = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/register-links',
      payload: { agent_code: 'DH-TST09' },
    });
    await fx.app.inject({
      method: 'DELETE',
      url: `/api/admin/register-links/${link.json().token as string}`,
    });

    const remove = await fx.app.inject({
      method: 'DELETE',
      url: '/api/admin/agent-services/DH-TST09',
    });
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

  it('省略 code → 平台生成 DH- 前缀 5 位编码，响应回显、落库唯一、可直接被引用', async () => {
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { name: '自动编码服务', platform_agent_name: 'demo' },
    });
    expect(created.statusCode).toBe(201);
    const code = created.json().code as string;
    // 去混淆 Base32：不含 I/L/O/U/0/1
    expect(code).toMatch(/^DH-[2-9A-HJKMNP-TV-Z]{5}$/);

    const list = await fx.app.inject({ method: 'GET', url: '/api/admin/agent-services' });
    expect(list.json().items.map((item: { code: string }) => item.code)).toContain(code);

    // 生成的编码与手写编码等价：注册链接能直接引用它
    const link = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/register-links',
      payload: { agent_code: code },
    });
    expect(link.statusCode).toBe(201);
  });

  it('连续两次自动生成 → 编码不同（不复用、不覆盖）', async () => {
    const first = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { name: '计划助手A', platform_agent_name: 'demo' },
    });
    const second = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agent-services',
      payload: { name: '计划助手B', platform_agent_name: 'demo' },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().code).not.toBe(second.json().code);
  });

  it('code 为空串 / 全空白 → 与省略同义（平台生成），不当作非法编码', async () => {
    for (const code of ['', '   ']) {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/api/admin/agent-services',
        payload: { code, name: '空编码服务', platform_agent_name: 'demo' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().code).toMatch(/^DH-[2-9A-HJKMNP-TV-Z]{5}$/);
    }
  });
});


describe('用户接口扩展（§13 users）', () => {
  it('列表带账号字段；创建可带 phone/role；删除同时清运行端部署', async () => {
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
    });
    // 授权已并入关联：注册用户建号即有 agents（不再是独立的 grants 摘要）
    expect(item.agents.map((a: { name: string }) => a.name)).toContain('demo');

    // 删除用户 → 记录消失（部署清理由 Deployer.purgeUser 负责）
    const remove = await fx.app.inject({ method: 'DELETE', url: `/api/admin/users/${userId}` });
    expect(remove.statusCode).toBe(204);
    const after = await fx.app.inject({ method: 'GET', url: '/api/admin/users?page=1' });
    expect(after.json().items.some((u: { user_id: string }) => u.user_id === userId)).toBe(false);
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

describe('用户授权与会话（2026-11-28 加固）', () => {
  it('PUT 授权：缺省 agents → 400，显式 [] 才清空（防静默撤销）', async () => {
    await fx.ctx.users.create('u_gr', ['demo']);
    const revision = fx.ctx.store.revision();

    const missing = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/users/u_gr',
      payload: { revision },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('VALIDATION_FAILED');

    const clear = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/users/u_gr',
      payload: { agents: [], revision },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json().agents).toEqual([]);
  });

  it('session/valid：用户不存在 → valid=false（exists 校验）', async () => {
    const res = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/auth/session/valid?user_id=ghost&session_id=s1',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(false);
  });

  it('删除用户后其会话即刻失效（session/valid 端到端）', async () => {
    await createService();
    const token = await createLink();
    const { userId } = await registerAndLogin('13700000003', '王五', token);
    const sessionId = await fx.ctx.sessionStore.getCurrentSession(userId);
    expect(sessionId).toBeTruthy();

    const remove = await fx.app.inject({ method: 'DELETE', url: `/api/admin/users/${userId}` });
    expect(remove.statusCode).toBe(204);

    const res = await fx.app.inject({
      method: 'GET',
      url: `/api/admin/auth/session/valid?user_id=${userId}&session_id=${sessionId}`,
    });
    expect(res.json().valid).toBe(false);
  });
});

describe('数字人 ⇔ 服务编码 1:1（§18）', () => {
  /** 取某数字人对应的服务（卡片按 platform_agent_name 匹配的同一个判据） */
  async function serviceOf(platformAgentName: string) {
    const list = await fx.app.inject({ method: 'GET', url: '/api/admin/agent-services' });
    return list
      .json()
      .items.find(
        (item: { platform_agent_name: string }) => item.platform_agent_name === platformAgentName,
      );
  }

  it('创建/复制数字人即自动开通服务编码（平台生成，1:1）', async () => {
    // beforeEach 已 POST /api/admin/agents 建了 demo
    const service = await serviceOf('demo');
    expect(service).toBeTruthy();
    expect(service.code).toMatch(/^DH-[2-9A-HJKMNP-TV-Z]{5}$/);
    expect(service.name).toBe('demo');
    expect(service.status).toBe('enabled');
  });

  it('删除数字人 → 服务编码一并撤掉，不留悬空编码', async () => {
    const remove = await fx.app.inject({ method: 'DELETE', url: '/api/admin/agents/demo' });
    expect(remove.statusCode).toBe(204);
    expect(await serviceOf('demo')).toBeUndefined();
  });

  it('删除前影响面：返回编码、关联用户与将被级联撤销的链接数（2026-11-27）', async () => {
    const service = await serviceOf('demo');
    const tokens: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const created = await fx.app.inject({
        method: 'POST',
        url: '/api/admin/register-links',
        payload: { agent_code: service.code },
      });
      tokens.push(created.json().token as string);
    }

    const impact = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/agents/demo/deletion-impact',
    });
    expect(impact.statusCode).toBe(200);
    expect(impact.json()).toEqual({
      name: 'demo',
      code: service.code,
      linked_users: [],
      active_register_links: 2,
    });

    // 已撤销的不再计入（过期但未撤销的仍计入——与删除时的级联判据同源）
    await fx.app.inject({ method: 'DELETE', url: `/api/admin/register-links/${tokens[0]}` });
    const after = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/agents/demo/deletion-impact',
    });
    expect(after.json().active_register_links).toBe(1);

    // 被用户关联时把关联人一并带回，界面据此提示"删不掉"
    await fx.ctx.users.create('ops', ['demo']);
    const linked = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/agents/demo/deletion-impact',
    });
    expect(linked.json().linked_users).toContain('ops');
  });

  it('不存在 → 404 ADM_AGENT_NOT_FOUND', async () => {
    const impact = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/agents/nope/deletion-impact',
    });
    expect(impact.statusCode).toBe(404);
    expect(impact.json().error.code).toBe('ADM_AGENT_NOT_FOUND');
  });

  it('删除数字人 → 未撤销的注册链接一并软撤销（记录保留，链接彻底不可用）', async () => {
    const service = await serviceOf('demo');
    const link = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/register-links',
      payload: { agent_code: service.code },
    });
    expect(link.statusCode).toBe(201);
    const token = link.json().token as string;

    const remove = await fx.app.inject({ method: 'DELETE', url: '/api/admin/agents/demo' });
    expect(remove.statusCode).toBe(204);

    // 数字人 json 与服务记录都删掉了
    expect((await fx.app.inject({ method: 'GET', url: '/api/admin/agents/demo' })).statusCode).toBe(
      404,
    );
    expect(await serviceOf('demo')).toBeUndefined();

    // 链接记录保留（审计），但已撤销且公开校验失败
    const links = await fx.app.inject({ method: 'GET', url: '/api/admin/register-links' });
    const kept = links.json().items.find((item: { token: string }) => item.token === token);
    expect(kept).toBeTruthy();
    expect(kept.revoked_at).toBeTruthy();

    const lookup = await fx.app.inject({
      method: 'GET',
      url: `/api/admin/auth/register-links/${token}`,
    });
    expect(lookup.statusCode).toBe(400);
    expect(lookup.json().error.code).toBe('ADM_INVALID_LINK');
  });
});
