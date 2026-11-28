/**
 * 单会话登记（`research.md` D11/D13，`contracts/auth-api.md` §2.4）。
 *
 * 为每个账号保存"当前唯一有效会话标识"：登录时覆盖、登出/删除用户时清除。
 * 运行侧经会话内省端点读取，从而实现"后登踢前登"。
 *
 * **读取必须回源**（file 读文件 / mysql 查表），不得缓存在进程内：会话是安全边界，
 * 多实例或运维脚本删行之后，内存副本会让本该失效的凭据继续可用。
 * 故端口方法一律 async。
 */
import type { PlatformStore } from '../../infra/platform-store.js';
import { SESSIONS_DIR } from '../account/paths.js';

export interface SessionRecord {
  user_id: string;
  session_id: string;
  issued_at: string;
}

/** 会话登记端口（028）：file / mysql 两驱动共同实现 */
export interface SessionPort {
  setCurrentSession(userId: string, sessionId: string): Promise<void>;
  getCurrentSession(userId: string): Promise<string | null>;
  clearSession(userId: string): Promise<void>;
  isCurrentSession(userId: string, sessionId: string): Promise<boolean>;
}

export class SessionStore implements SessionPort {
  constructor(private readonly store: PlatformStore) {}

  static relPath(userId: string): string {
    return `${SESSIONS_DIR}/${userId}.json`;
  }

  /** 覆盖该账号的当前会话（= 后登踢前登）。 */
  async setCurrentSession(userId: string, sessionId: string): Promise<void> {
    this.store.writeJson(SessionStore.relPath(userId), {
      user_id: userId,
      session_id: sessionId,
      issued_at: new Date().toISOString(),
    } satisfies SessionRecord);
  }

  /** 读取当前会话标识；无记录返回 `null`（每次读盘，不缓存）。 */
  async getCurrentSession(userId: string): Promise<string | null> {
    const doc = this.store.readJson<SessionRecord>(SessionStore.relPath(userId));
    return doc && typeof doc.session_id === 'string' ? doc.session_id : null;
  }

  /** 清除会话登记（登出 / 删除用户）。幂等：文件不存在时 `remove` 是空操作。 */
  async clearSession(userId: string): Promise<void> {
    this.store.remove(SessionStore.relPath(userId));
  }

  /** 某会话是否仍为该账号的当前会话。 */
  async isCurrentSession(userId: string, sessionId: string): Promise<boolean> {
    return (await this.getCurrentSession(userId)) === sessionId;
  }
}
