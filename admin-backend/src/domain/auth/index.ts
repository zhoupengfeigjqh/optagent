/**
 * 认证域的唯一导出面（`plan.md`「模块职责」）。
 *
 * 外部只从此处取用；`config-center/user-links.ts` 例外——为避免 `service → user-links`
 * 与 `user-links → index → service` 形成环，它直接从 `password.js` 取 `hashPassword`。
 */
export {
  hashPassword,
  verifyPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  type PasswordRecord,
} from './password.js';
export {
  signSession,
  verifySession,
  cookieHeader,
  clearCookieHeader,
  readCookie,
  AUTH_COOKIE_NAME,
  AUTH_ISSUER,
  AUTH_AUDIENCE,
  type SessionClaims,
} from './token.js';
export { SessionStore, type SessionRecord } from './session-store.js';
export { AuthService, type AuthServiceConfig } from './service.js';
