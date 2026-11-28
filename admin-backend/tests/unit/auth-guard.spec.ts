/**
 * 单元测试：管理端统一鉴权钩子（030）
 *
 * 覆盖路由归类（公开 / 登录即可 / 管理员）与钩子的四类结局：
 * 放行、401（无凭据 / 被踢）、403（普通用户调管理接口）。
 */
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AppContext } from '../../src/context.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import {
  AUTH_PUBLIC_ROUTES,
  AUTH_USER_LEVEL_ROUTES,
  createAdminGuard,
  matchesRules,
  requireLogin,
} from '../../src/domain/auth/guard.js';
import { AUTH_COOKIE_NAME, signSession } from '../../src/domain/auth/token.js';

const SECRET = 'test-secret-0123456789';
const ROLE: Record<string, 'admin' | 'user'> = { boss: 'admin', ops: 'user' };

function makeCtx(currentSession: Record<string, string> = {}): AppContext {
  return {
    config: { authSecret: SECRET },
    auth: {
      introspect: async (userId: string, sessionId: string) =>
        (currentSession[userId] ?? null) === sessionId,
    },
    users: {
      exists: (userId: string) => userId in ROLE,
      readOrNull: (userId: string) =>
        userId in ROLE ? { user_id: userId, role: ROLE[userId] } : null,
    },
  } as unknown as AppContext;
}

function reqOf(method: string, url: string, cookie?: string): FastifyRequest {
  return { method, url, headers: cookie ? { cookie } : {} } as unknown as FastifyRequest;
}

async function cookieOf(userId: string, sessionId: string): Promise<string> {
  return `${AUTH_COOKIE_NAME}=${await signSession(userId, sessionId, SECRET, 600)}`;
}

describe('路由归类', () => {
  it('公开端点：登录 / 注册 / 链接校验 / 会话内省 / 健康探针', () => {
    expect(matchesRules(AUTH_PUBLIC_ROUTES, 'POST', '/api/admin/auth/login')).toBe(true);
    expect(matchesRules(AUTH_PUBLIC_ROUTES, 'POST', '/api/admin/auth/register')).toBe(true);
    expect(
      matchesRules(AUTH_PUBLIC_ROUTES, 'GET', '/api/admin/auth/register-links/tok-1'),
    ).toBe(true);
    expect(matchesRules(AUTH_PUBLIC_ROUTES, 'GET', '/api/admin/auth/session/valid')).toBe(true);
    expect(matchesRules(AUTH_PUBLIC_ROUTES, 'GET', '/api/admin/platform/health')).toBe(true);
    // 方法不符不算命中
    expect(matchesRules(AUTH_PUBLIC_ROUTES, 'GET', '/api/admin/auth/login')).toBe(false);
  });

  it('登录即可：me / my-agents；登出属公开幂等端点', () => {
    expect(matchesRules(AUTH_USER_LEVEL_ROUTES, 'GET', '/api/admin/auth/me')).toBe(true);
    expect(matchesRules(AUTH_USER_LEVEL_ROUTES, 'GET', '/api/admin/auth/my-agents')).toBe(true);
    expect(matchesRules(AUTH_USER_LEVEL_ROUTES, 'GET', '/api/admin/users')).toBe(false);
    // 登出放行到路由内部做归属校验：旧会话登出返回 204，且不得删当前会话
    expect(matchesRules(AUTH_PUBLIC_ROUTES, 'POST', '/api/admin/auth/logout')).toBe(true);
  });
});

describe('createAdminGuard', () => {
  it('非 /api/admin 路径直接放行（不读凭据）', async () => {
    const guard = createAdminGuard(makeCtx());
    await expect(guard(reqOf('GET', '/healthz'))).resolves.toBeUndefined();
  });

  it('公开端点无凭据也放行；查询串不影响匹配', async () => {
    const guard = createAdminGuard(makeCtx());
    await expect(
      guard(reqOf('GET', '/api/admin/platform/health')),
    ).resolves.toBeUndefined();
    await expect(
      guard(reqOf('GET', '/api/admin/auth/session/valid?user_id=ops&session_id=x')),
    ).resolves.toBeUndefined();
  });

  it('无 Cookie 调管理接口 → 401', async () => {
    const guard = createAdminGuard(makeCtx());
    await expect(guard(reqOf('GET', '/api/admin/users'))).rejects.toMatchObject({
      code: ERROR_CODES.ADM_UNAUTHENTICATED,
    });
    await expect(guard(reqOf('POST', '/api/admin/deploy'))).rejects.toMatchObject({
      code: ERROR_CODES.ADM_UNAUTHENTICATED,
    });
  });

  it('管理员访问管理接口放行；可访问自助端点', async () => {
    const guard = createAdminGuard(makeCtx({ boss: 's-boss' }));
    const cookie = await cookieOf('boss', 's-boss');
    await expect(guard(reqOf('GET', '/api/admin/users', cookie))).resolves.toBeUndefined();
    await expect(
      guard(reqOf('GET', '/api/admin/auth/me', cookie)),
    ).resolves.toBeUndefined();
  });

  it('普通用户：自助端点放行，管理接口 403', async () => {
    const guard = createAdminGuard(makeCtx({ ops: 's-ops' }));
    const cookie = await cookieOf('ops', 's-ops');
    await expect(
      guard(reqOf('GET', '/api/admin/auth/my-agents', cookie)),
    ).resolves.toBeUndefined();
    await expect(guard(reqOf('GET', '/api/admin/users', cookie))).rejects.toMatchObject({
      code: ERROR_CODES.ADM_FORBIDDEN,
      statusCode: 403,
    });
    await expect(guard(reqOf('DELETE', '/api/admin/users/ops', cookie))).rejects.toMatchObject({
      code: ERROR_CODES.ADM_FORBIDDEN,
    });
  });

  it('被其它设备顶掉（内省不一致）→ 401', async () => {
    const guard = createAdminGuard(makeCtx({ boss: 's-new' }));
    const stale = await cookieOf('boss', 's-old');
    await expect(guard(reqOf('GET', '/api/admin/users', stale))).rejects.toMatchObject({
      code: ERROR_CODES.ADM_UNAUTHENTICATED,
    });
  });

  it('伪造/过期凭据 → 401', async () => {
    const guard = createAdminGuard(makeCtx({ boss: 's-boss' }));
    const forged = `${AUTH_COOKIE_NAME}=${await signSession('boss', 's-boss', 'other-secret', 600)}`;
    await expect(guard(reqOf('GET', '/api/admin/users', forged))).rejects.toMatchObject({
      code: ERROR_CODES.ADM_UNAUTHENTICATED,
    });
  });
});

describe('requireLogin', () => {
  it('有效会话返回用户标识', async () => {
    const ctx = makeCtx({ boss: 's-boss' });
    await expect(requireLogin(reqOf('GET', '/api/admin/users', await cookieOf('boss', 's-boss')), ctx)).resolves.toBe('boss');
  });
});
