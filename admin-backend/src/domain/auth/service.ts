/**
 * 登录鉴权编排（`plan.md`「模块职责」§4）。
 *
 * 只做编排：读用户记录、验密码、登记会话、签发/清除凭据、会话内省。
 * 不感知 HTTP（Cookie 头由 routes 下发），不感知运行侧实现（运行侧只认契约）。
 */
import { randomUUID } from 'node:crypto';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import type { UserLinkService } from '../config-center/user-links.js';
import { verifyPassword } from './password.js';
import { signSession, cookieHeader, clearCookieHeader } from './token.js';
import type { SessionStore } from './session-store.js';

export interface AuthServiceConfig {
  /** 凭据签名密钥（与运行侧同值） */
  secret: string;
  /** 凭据有效期（秒） */
  ttlSeconds: number;
}

export class AuthService {
  constructor(
    private readonly users: UserLinkService,
    private readonly sessions: SessionStore,
    private readonly config: AuthServiceConfig,
  ) {}

  /**
   * 登录：账号不存在 / 密码错误 / 存量无密码 → **同一** `ADM_INVALID_CREDENTIALS`
   * （不枚举，`FR-011`）。成功则登记当前会话并签发凭据。
   */
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

  /** 会话内省：供运行侧确认某会话是否仍为该账号的当前会话。 */
  introspect(userId: string, sessionId: string): boolean {
    return this.sessions.isCurrentSession(userId, sessionId);
  }

  /** 登出：清除会话登记并返回清 Cookie 头。 */
  logout(userId: string): string {
    this.sessions.clearSession(userId);
    return clearCookieHeader();
  }

  /** 删除用户时清除其会话（`FR-012`：旧凭据即时失效）。 */
  revokeUser(userId: string): void {
    this.sessions.clearSession(userId);
  }
}
