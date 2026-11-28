/**
 * 集成测试：管理端接口统一鉴权（030，真实守卫）
 *
 * 场景全部来自实测缺陷：无 Cookie 可调管理接口、普通用户等同管理员、
 * 被其它设备顶掉后仍能继续操作、旧凭据登出会误杀当前会话。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { createFixture, type TestFixture } from '../helpers/fixture.js';

const PASSWORD = 'pw-123456';

let fx: TestFixture | undefined;

afterEach(async () => {
  await fx?.cleanup();
  fx = undefined;
});

async function setup(): Promise<TestFixture> {
  fx = await createFixture({ realAdminGuard: true });
  await fx.ctx.users.create('boss', [], undefined, PASSWORD, { role: 'admin' });
  await fx.ctx.users.create('ops', [], undefined, PASSWORD, { role: 'user' });
  return fx;
}

/** 登录并返回可直接放进请求头的 Cookie 串 */
async function login(f: TestFixture, userId: string): Promise<string> {
  const res = await f.app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    payload: { user_id: userId, password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0]! : String(raw);
  return value.split(';')[0]!;
}

describe('未登录：白名单以外一律 401', () => {
  it('管理类接口逐个拒绝', async () => {
    const f = await setup();
    const targets: Array<[string, string]> = [
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users'],
      ['GET', '/api/admin/agents'],
      ['GET', '/api/admin/mcp/services'],
      ['GET', '/api/admin/skills'],
      ['GET', '/api/admin/ontologies'],
      ['GET', '/api/admin/agent-services'],
      ['GET', '/api/admin/register-links'],
      ['GET', '/api/admin/deploy/manifest'],
      ['POST', '/api/admin/deploy'],
      ['GET', '/api/admin/references?target_type=skill&target_name=x'],
    ];
    for (const [method, url] of targets) {
      const res = await f.app.inject({ method: method as 'GET', url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.ADM_UNAUTHENTICATED } });
    }
  });

  it('公开端点仍可访问（健康探针 / 会话内省 / 链接校验）', async () => {
    const f = await setup();
    const health = await f.app.inject({ method: 'GET', url: '/api/admin/platform/health' });
    expect(health.statusCode).toBe(200);

    const probe = await f.app.inject({
      method: 'GET',
      url: '/api/admin/auth/session/valid?user_id=ops&session_id=none',
    });
    expect(probe.statusCode).toBe(200);
    expect(probe.json()).toMatchObject({ valid: false });

    const link = await f.app.inject({
      method: 'GET',
      url: '/api/admin/auth/register-links/not-exist',
    });
    expect(link.statusCode).not.toBe(401);
  });
});

describe('已登录：普通用户与管理员分级', () => {
  it('普通用户：自助端点可用，管理接口 403', async () => {
    const f = await setup();
    const cookie = await login(f, 'ops');

    for (const url of ['/api/admin/auth/me', '/api/admin/auth/my-agents']) {
      const res = await f.app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.statusCode, url).toBe(200);
    }

    const forbidden = await f.app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ error: { code: ERROR_CODES.ADM_FORBIDDEN } });
  });

  it('管理员：管理接口可用', async () => {
    const f = await setup();
    const cookie = await login(f, 'boss');
    const res = await f.app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('单会话：被顶掉后立即失效', () => {
  it('A 登录 → B 登录 → A 的任意请求即 401（无需刷新页面以外的等待）', async () => {
    const f = await setup();
    const aCookie = await login(f, 'boss');

    // A 此刻可用
    expect(
      (await f.app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: aCookie } }))
        .statusCode,
    ).toBe(200);

    const bCookie = await login(f, 'boss');

    const staleUsers = await f.app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: aCookie },
    });
    expect(staleUsers.statusCode).toBe(401);

    const staleMe = await f.app.inject({
      method: 'GET',
      url: '/api/admin/auth/me',
      headers: { cookie: aCookie },
    });
    expect(staleMe.statusCode).toBe(401);

    // B 不受影响
    expect(
      (await f.app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: bCookie } }))
        .statusCode,
    ).toBe(200);
  });

  it('旧凭据登出不会踢掉当前会话', async () => {
    const f = await setup();
    const aCookie = await login(f, 'boss');
    const bCookie = await login(f, 'boss');

    const logout = await f.app.inject({
      method: 'POST',
      url: '/api/admin/auth/logout',
      headers: { cookie: aCookie },
    });
    expect(logout.statusCode).toBe(204);

    // B 仍是当前会话
    const me = await f.app.inject({
      method: 'GET',
      url: '/api/admin/auth/me',
      headers: { cookie: bCookie },
    });
    expect(me.statusCode).toBe(200);
  });
});
