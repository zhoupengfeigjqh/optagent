import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/domain/auth/service.js';
import { SessionStore } from '../../src/domain/auth/session-store.js';
import { verifySession } from '../../src/domain/auth/token.js';
import { UserLinkService } from '../../src/domain/config-center/user-links.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

const SECRET = 'test-secret-0123456789';

let root: string;
let users: UserLinkService;
let sessions: SessionStore;
let auth: AuthService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-service-'));
  const store = new PlatformStore(root);
  store.ensureLayout();
  users = new UserLinkService(store);
  sessions = new SessionStore(store);
  auth = new AuthService(users, sessions, { secret: SECRET, ttlSeconds: 3600 });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function tokenFromCookie(cookie: string): string {
  const pair = cookie.split(';')[0] ?? '';
  return decodeURIComponent(pair.slice(pair.indexOf('=') + 1));
}

describe('AuthService', () => {
  it('登录成功：返回 user_id + 可验签 Cookie，并登记会话', async () => {
    await users.create('zpf', [], undefined, '123456');
    const res = await auth.login('zpf', '123456');
    expect(res.userId).toBe('zpf');
    expect(res.cookie).toContain('optagent_auth=');
    const claims = await verifySession(tokenFromCookie(res.cookie), SECRET);
    expect(claims.userId).toBe('zpf');
    expect(await sessions.isCurrentSession('zpf', claims.sessionId)).toBe(true);
  });

  it('密码错 / 账号不存在 / 存量无密码 → 同码 ADM_INVALID_CREDENTIALS', async () => {
    await users.create('zpf', [], undefined, '123456');
    await users.create('nopw', []);
    const cases: Array<[string, string]> = [
      ['zpf', 'wrong'],
      ['ghost', 'x'],
      ['nopw', 'x'],
    ];
    for (const [userId, password] of cases) {
      await expect(auth.login(userId, password)).rejects.toMatchObject({
        code: ERROR_CODES.ADM_INVALID_CREDENTIALS,
      });
    }
  });

  it('二次登录覆盖旧会话（后登踢前登）', async () => {
    await users.create('zpf', [], undefined, '123456');
    const first = await auth.login('zpf', '123456');
    const firstSession = (await verifySession(tokenFromCookie(first.cookie), SECRET)).sessionId;
    await auth.login('zpf', '123456');
    expect(await sessions.isCurrentSession('zpf', firstSession)).toBe(false);
  });

  it('登出只清自己的会话（旧凭据不得踢掉新会话）', async () => {
    await users.create('zpf', [], undefined, '123456');
    const res = await auth.login('zpf', '123456');
    const claims = await verifySession(tokenFromCookie(res.cookie), SECRET);

    // 非当前会话的凭据登出：不清除（否则 A 退出会把 B 踢下线）
    expect(await auth.logout('zpf', 'not-current')).toContain('Max-Age=0');
    expect(await sessions.getCurrentSession('zpf')).toBe(claims.sessionId);

    // 当前会话登出：清除
    expect(await auth.logout('zpf', claims.sessionId)).toContain('Max-Age=0');
    expect(await sessions.getCurrentSession('zpf')).toBeNull();
  });

  it('内省判定当前会话', async () => {
    await users.create('zpf', [], undefined, '123456');
    const res = await auth.login('zpf', '123456');
    const claims = await verifySession(tokenFromCookie(res.cookie), SECRET);
    expect(await auth.introspect('zpf', claims.sessionId)).toBe(true);
    expect(await auth.introspect('zpf', 'other')).toBe(false);
  });
});
