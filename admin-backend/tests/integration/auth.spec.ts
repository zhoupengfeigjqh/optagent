/**
 * 集成测试：登录鉴权全链路（024）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifySession } from '../../src/domain/auth/token.js';
import { createFixture, type TestFixture } from '../helpers/fixture.js';

let fx: TestFixture;

beforeEach(async () => {
  fx = await createFixture();
});

afterEach(async () => {
  await fx.cleanup();
});

function cookieToken(setCookie: string): string {
  return setCookie.split(';')[0] ?? '';
}

describe('登录鉴权（024）', () => {
  it('登录 → 探针 → 登出 全链路', async () => {
    fx.ctx.users.create('zpf', [], undefined, '123456');

    const login = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { user_id: 'zpf', password: '123456' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user_id).toBe('zpf');
    const setCookie = login.headers['set-cookie'] as string;
    expect(setCookie).toContain('optagent_auth=');
    const cookie = cookieToken(setCookie);

    const me = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/auth/me',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user_id).toBe('zpf');

    const logout = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/logout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);

    const meAfter = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/auth/me',
      headers: { cookie },
    });
    expect(meAfter.statusCode).toBe(401);
  });

  it('登录失败不枚举（同码同文案）', async () => {
    fx.ctx.users.create('zpf', [], undefined, '123456');
    const wrongPassword = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { user_id: 'zpf', password: 'wrong' },
    });
    const ghost = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { user_id: 'ghost', password: 'x' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(ghost.statusCode).toBe(401);
    expect(wrongPassword.json().error.code).toBe('ADM_INVALID_CREDENTIALS');
    expect(ghost.json().error.code).toBe('ADM_INVALID_CREDENTIALS');
  });

  it('二次登录后旧会话内省失效（后登踢前登）', async () => {
    fx.ctx.users.create('zpf', [], undefined, '123456');
    const first = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { user_id: 'zpf', password: '123456' },
    });
    const token = cookieToken(first.headers['set-cookie'] as string).split('=')[1] ?? '';
    const claims = await verifySession(decodeURIComponent(token), fx.config.authSecret);

    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { user_id: 'zpf', password: '123456' },
    });

    const valid = await fx.app.inject({
      method: 'GET',
      url: `/api/admin/auth/session/valid?user_id=zpf&session_id=${encodeURIComponent(claims.sessionId)}`,
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json().valid).toBe(false);
  });
});
