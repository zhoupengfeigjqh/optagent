/**
 * 单会话登记（`research.md` D11/D13，`contracts/auth-api.md` §2.4）。
 *
 * 为每个账号保存"当前唯一有效会话标识"：登录时覆盖、登出/删除用户时清除。
 * 运行侧经会话内省端点读取，从而实现"后登踢前登"。
 *
 * 复用 `PlatformStore` 的原子写（临时文件 → rename），落在 `.platform-data/sessions/{uid}.json`。
 */
import type { PlatformStore } from '../../infra/platform-store.js';

const SESSIONS_DIR = 'sessions';

export interface SessionRecord {
  user_id: string;
  session_id: string;
  issued_at: string;
}

export class SessionStore {
  constructor(private readonly store: PlatformStore) {}

  static relPath(userId: string): string {
    return `${SESSIONS_DIR}/${userId}.json`;
  }

  /** 覆盖该账号的当前会话（= 后登踢前登）。 */
  setCurrentSession(userId: string, sessionId: string): void {
    this.store.writeJson(SessionStore.relPath(userId), {
      user_id: userId,
      session_id: sessionId,
      issued_at: new Date().toISOString(),
    } satisfies SessionRecord);
  }

  /** 读取当前会话标识；无记录返回 `null`。 */
  getCurrentSession(userId: string): string | null {
    const doc = this.store.readJson<SessionRecord>(SessionStore.relPath(userId));
    return doc && typeof doc.session_id === 'string' ? doc.session_id : null;
  }

  /** 清除会话登记（登出 / 删除用户）。幂等。 */
  clearSession(userId: string): void {
    if (!this.store.exists(SessionStore.relPath(userId))) return;
    this.store.remove(SessionStore.relPath(userId));
  }

  /** 某会话是否仍为该账号的当前会话。 */
  isCurrentSession(userId: string, sessionId: string): boolean {
    return this.getCurrentSession(userId) === sessionId;
  }
}
