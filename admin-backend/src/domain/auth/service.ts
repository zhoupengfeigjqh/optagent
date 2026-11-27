import { randomUUID } from 'node:crypto';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import type { UserLinkService } from '../config-center/user-links.js';
import { verifyPassword } from './password.js';
import { signSession, cookieHeader, clearCookieHeader } from './token.js';
import type { SessionStore } from './session-store.js';

export interface AuthServiceConfig {
  secret: string;
  ttlSeconds: number;
}

export class AuthService {
  constructor(
    private readonly users: UserLinkService,
    private readonly sessions: SessionStore,
    private readonly config: AuthServiceConfig,
  ) {}

  async login(
    userIdRaw: unknown,
    passwordRaw: unknown,
  ): Promise<{ userId: string; cookie: string }> {
    const invalid = (): ApiError =>
      new ApiError(ERROR_CODES.ADM_INVALID_CREDENTIALS, '账号或密码错误');
    const userId = typeof userIdRaw === 'string' ? userIdRaw.trim() : '';
    const password = typeof passwordRaw === 'string' ? passwordRaw : '';
    if (userId === '' || password === '') throw invalid();

    const doc = this.users.readOrNull(userId);
    if (!doc || !verifyPassword(password, doc.password)) throw invalid();

    const sessionId = randomUUID();
    this.sessions.setCurrentSession(userId, sessionId);
    const token = await signSession(userId, sessionId, this.config.secret, this.config.ttlSeconds);
    return { userId, cookie: cookieHeader(token, this.config.ttlSeconds) };
  }

  introspect(userId: string, sessionId: string): boolean {
    return this.sessions.isCurrentSession(userId, sessionId);
  }

  logout(userId: string): string {
    this.sessions.clearSession(userId);
    return clearCookieHeader();
  }

  revokeUser(userId: string): void {
    this.sessions.clearSession(userId);
  }
}
