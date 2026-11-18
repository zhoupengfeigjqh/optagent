/**
 * 单元测试：登录凭据签发/验签（`contracts/auth-api.md` §1）
 */
import { describe, expect, it } from 'vitest';
import {
  AUTH_COOKIE_NAME,
  clearCookieHeader,
  cookieHeader,
  signSession,
  verifySession,
} from '../../src/domain/auth/token.js';

const SECRET = 'test-secret-0123456789';

describe('token', () => {
  it('签发→验签往返，claims 正确', async () => {
    const token = await signSession('zpf', 'sess-1', SECRET, 3600);
    await expect(verifySession(token, SECRET)).resolves.toEqual({
      userId: 'zpf',
      sessionId: 'sess-1',
    });
  });

  it('密钥不符被拒', async () => {
    const token = await signSession('zpf', 'sess-1', SECRET, 3600);
    await expect(verifySession(token, 'other-secret-0123456789')).rejects.toBeTruthy();
  });

  it('过期被拒', async () => {
    const token = await signSession('zpf', 'sess-1', SECRET, -1);
    await expect(verifySession(token, SECRET)).rejects.toBeTruthy();
  });

  it('篡改 payload 被拒', async () => {
    const token = await signSession('zpf', 'sess-1', SECRET, 3600);
    const parts = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'hacker', jti: 'x' })).toString('base64url');
    await expect(verifySession(`${parts[0]}.${forged}.${parts[2]}`, SECRET)).rejects.toBeTruthy();
  });

  it('Cookie 头契约一致', () => {
    const header = cookieHeader('t', 100);
    expect(header).toContain(`${AUTH_COOKIE_NAME}=t`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Path=/');
    expect(header).toContain('SameSite=Lax');
    expect(clearCookieHeader()).toContain('Max-Age=0');
  });
});
