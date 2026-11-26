import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { getCurrentUser } from '../../src/domain/current-user.js';
import { AUTH_ALLOWLIST, AuthError, createAuthHook } from '../../src/infra/auth.js';

const SECRET = 'test-secret-0123456789';

async function makeToken(userId: string, sessionId: string, secret = SECRET): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ jti: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer('optagent-admin')
    .setAudience('optagent-agent')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(new TextEncoder().encode(secret));
}

function fakeReq(url: string, cookie?: string) {
  return {
    url,
    headers: cookie ? { cookie } : {},
    log: { warn: () => undefined },
  } as never;
}

type Hook = ReturnType<typeof createAuthHook>;

function runHook(hook: Hook, req: unknown): Promise<{ userId?: string }> {
  return new Promise((resolve, reject) => {
    hook(req as never, {} as never, (err?: Error) => {
      if (err) reject(err);
      else resolve({ userId: getCurrentUser().userId });
    });
  });
}

describe('createAuthHook', () => {
  it('白名单放行（不注入身份）', async () => {
    const hook = createAuthHook({ secret: SECRET });
    for (const path of AUTH_ALLOWLIST) {
      await expect(runHook(hook, fakeReq(path))).resolves.toEqual({ userId: 'admin' });
    }
  });

  it('签名直链免 Cookie（调用方是 MCP 服务容器，URL 即凭证；2026-11-18）', async () => {
    const hook = createAuthHook({ secret: SECRET });
    for (const path of ['/api/files/raw', '/api/files/put']) {
      await expect(
        runHook(hook, fakeReq(`${path}?u=admin&p=x&exp=1&sig=y`)),
      ).resolves.toBeDefined();
    }
  });

  it('缺少 Cookie → 401 UNAUTHENTICATED', async () => {
    const hook = createAuthHook({ secret: SECRET });
    await expect(runHook(hook, fakeReq('/api/agents'))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('坏 token → 401 UNAUTHENTICATED', async () => {
    const hook = createAuthHook({ secret: SECRET });
    await expect(
      runHook(hook, fakeReq('/api/agents', 'optagent_auth=not-a-jwt')),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('有效 token → 注入请求级身份', async () => {
    const hook = createAuthHook({ secret: SECRET });
    const token = await makeToken('zpf', 's1');
    const seen = await runHook(hook, fakeReq('/api/agents', `optagent_auth=${token}`));
    expect(seen.userId).toBe('zpf');
  });

  it('被踢（内省 false）→ 401 SESSION_REVOKED', async () => {
    const hook = createAuthHook({ secret: SECRET, introspect: async () => false });
    const token = await makeToken('zpf', 's1');
    await expect(runHook(hook, fakeReq('/api/agents', `optagent_auth=${token}`))).rejects.toMatchObject(
      { code: 'SESSION_REVOKED' },
    );
  });

  it('内省不可达 → 放行（降级）', async () => {
    const hook = createAuthHook({
      secret: SECRET,
      introspect: async () => {
        throw new Error('network down');
      },
    });
    const token = await makeToken('zpf', 's1');
    const seen = await runHook(hook, fakeReq('/api/agents', `optagent_auth=${token}`));
    expect(seen.userId).toBe('zpf');
  });

  it('未配置密钥 → 放行（legacy 单用户回退）', async () => {
    const hook = createAuthHook({});
    await expect(runHook(hook, fakeReq('/api/agents'))).resolves.toEqual({ userId: 'admin' });
  });
});
