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

  setCurrentSession(userId: string, sessionId: string): void {
    this.store.writeJson(SessionStore.relPath(userId), {
      user_id: userId,
      session_id: sessionId,
      issued_at: new Date().toISOString(),
    } satisfies SessionRecord);
  }

  getCurrentSession(userId: string): string | null {
    const doc = this.store.readJson<SessionRecord>(SessionStore.relPath(userId));
    return doc && typeof doc.session_id === 'string' ? doc.session_id : null;
  }

  /** 清除会话登记（登出 / 删除用户）。幂等。 */
  clearSession(userId: string): void {
    if (!this.store.exists(SessionStore.relPath(userId))) return;
    this.store.remove(SessionStore.relPath(userId));
  }

  isCurrentSession(userId: string, sessionId: string): boolean {
    return this.getCurrentSession(userId) === sessionId;
  }
}
