/**
 * 登录鉴权编排（`plan.md`「模块职责」§4）。
 *
 * 只做编排：读用户记录、验密码、登记会话、签发/清除凭据、会话内省。
 * 不感知 HTTP（Cookie 头由 routes 下发），不感知运行侧实现（运行侧只认契约）。
 *
 * **028 阶段 1**：依赖类型放宽为端口（`UserLinkPort` / `SessionPort`），
 * file / mysql 两驱动通用；会话登记、读取、清除一律异步（mysql 驱动每次查表）。
 * `introspect` 因此也是异步，HTTP 契约不变。
 */
import { randomUUID } from 'node:crypto';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import type { UserLinkDocument, UserLinkPort } from '../config-center/user-links.js';
import { verifyPassword } from './password.js';
import { signSession, cookieHeader, clearCookieHeader } from './token.js';
import type { SessionPort } from './session-store.js';

export interface AuthServiceConfig {
  /** 凭据签名密钥（与运行侧同值） */
  secret: string;
  /** 凭据有效期（秒） */
  ttlSeconds: number;
}

export class AuthService {
  constructor(
    private readonly users: UserLinkPort,
    private readonly sessions: SessionPort,
    private readonly config: AuthServiceConfig,
  ) {}

  /**
   * 登录：账号不存在 / 密码错误 / 存量无密码 → **同一** `ADM_INVALID_CREDENTIALS`
   * （不枚举，`FR-011`）。成功则登记当前会话并签发凭据。
   *
   * 028：`user_id` 与 `phone` 二选一（`user_id` 优先）；`phone` 命中后解析为
   * `user_id` 再验密码——JWT `sub` 恒为 `user_id`（D1），手机号只作登录标识。
   */
  async login(
    userIdRaw: unknown,
    passwordRaw: unknown,
    phoneRaw?: unknown,
  ): Promise<{ userId: string; cookie: string }> {
    const invalid = (): ApiError =>
      new ApiError(ERROR_CODES.ADM_INVALID_CREDENTIALS, '账号或密码错误');
    const password = typeof passwordRaw === 'string' ? passwordRaw : '';
    if (password === '') throw invalid();

    const userId = typeof userIdRaw === 'string' ? userIdRaw.trim() : '';
    let doc: UserLinkDocument | null = null;
    // 029：库里可能刚被运维脚本改过密码（另一进程），登录前拉一次最新投影
    await this.users.refresh?.();
    if (userId !== '') {
      doc = this.users.readOrNull(userId);
    } else if (typeof phoneRaw === 'string' && phoneRaw.trim() !== '') {
      doc = this.users.findByPhone(phoneRaw.trim());
    }
    if (!doc || !verifyPassword(password, doc.password)) throw invalid();

    const sessionId = randomUUID();
    await this.sessions.setCurrentSession(doc.user_id, sessionId);
    const token = await signSession(doc.user_id, sessionId, this.config.secret, this.config.ttlSeconds);
    return { userId: doc.user_id, cookie: cookieHeader(token, this.config.ttlSeconds) };
  }

  /** 会话内省：供运行侧确认某会话是否仍为该账号的当前会话（回源读取，不认缓存）。 */
  async introspect(userId: string, sessionId: string): Promise<boolean> {
    return this.sessions.isCurrentSession(userId, sessionId);
  }

  /**
   * 登出：仅当该会话仍是当前会话时才清除登记，返回清 Cookie 头。
   *
   * 会话按 `userId` 存储，若不做归属校验，持旧凭据的一方登出会把"后登录者"踢下线。
   */
  async logout(userId: string, sessionId: string): Promise<string> {
    if (await this.sessions.isCurrentSession(userId, sessionId)) {
      await this.sessions.clearSession(userId);
    }
    return clearCookieHeader();
  }

  /** 删除用户时清除其会话（`FR-012`：旧凭据即时失效）。 */
  async revokeUser(userId: string): Promise<void> {
    await this.sessions.clearSession(userId);
  }
}
