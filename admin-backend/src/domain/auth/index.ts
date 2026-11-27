/**
 * 认证域的名义导出面（`plan.md`「模块职责」）。
 *
 * **现状（2026-11-27 复核）**：全仓无任何文件 import 本文件——所有消费方都直接引
 * `password.js` / `token.js` / `service.js` / `session-store.js`。保留它是为避免
 * 与 `plan.md` 的"域边界"约定冲突；新增消费方若想走 barrel，可直接用这里。
 * 若此状态长期不变，应连同 `plan.md` 一起删掉这层间接。
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
