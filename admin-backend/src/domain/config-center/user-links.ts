/**
 * 用户与其关联数字人（`FR-023`~`FR-025`，`data-model.md` §6）。
 *
 * **注意区分两个"用户"概念**（`research.md` D11）：本实体是**平台的业务使用者**
 * （如 `admin`，会被分配数字人），与平台操作者 `zyw_admin`（仅用于审计字段）
 * 是**两个不同概念**，MUST NOT 混用。
 */
import { ApiError } from '../api-error.js';
import { hashPassword, type PasswordRecord } from '../auth/password.js';
import { ERROR_CODES } from '../error-codes.js';
import { paginate, type Paged } from '../paging.js';
import type { PlatformStore } from '../../infra/platform-store.js';
import { isSafeName } from './naming.js';

const USERS_DIR = 'users';

export interface UserLinkDocument {
  user_id: string;
  agents: string[];
  /** 024：密码摘要（scrypt）；存量用户缺省 = 不可登录（`FR-013`）。对外视图不下发。 */
  password?: PasswordRecord;
}

/** 对外视图：**不含**密码摘要。 */
export interface UserView {
  user_id: string;
  agents: string[];
  revision: number;
}

export class UserLinkService {
  constructor(private readonly store: PlatformStore) {}

  static relPath(userId: string): string {
    return `${USERS_DIR}/${userId}.json`;
  }

  listAll(): UserLinkDocument[] {
    return this.store
      .listDir(USERS_DIR)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length))
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
      .map((userId) => this.readOrNull(userId))
      .filter((doc): doc is UserLinkDocument => doc !== null);
  }

  exists(userId: string): boolean {
    return this.store.exists(UserLinkService.relPath(userId));
  }

  readOrNull(userId: string): UserLinkDocument | null {
    return this.store.readJson<UserLinkDocument>(UserLinkService.relPath(userId));
  }

  read(userId: string): UserLinkDocument {
    const doc = this.readOrNull(userId);
    if (!doc) throw new ApiError(ERROR_CODES.ADM_USER_NOT_FOUND, `用户不存在：${userId}`);
    return doc;
  }

  /** 关联了该数字人的用户标识清单（供 `FR-021` 阻止删除与 `§7.1` 引用查询） */
  usersOfAgent(agentName: string): string[] {
    return this.listAll()
      .filter((user) => user.agents.includes(agentName))
      .map((user) => user.user_id);
  }

  /** 列表（卡片：用户名 + 已关联数字人角色名清单，`FR-023`） */
  list(page: number, toItem: (user: UserLinkDocument) => unknown): Paged<unknown> {
    return paginate(this.listAll().map(toItem), page);
  }

  create(
    userIdRaw: unknown,
    agentsRaw: unknown,
    revision?: number,
    passwordRaw?: unknown,
  ): UserView {
    const userId = this.requireUserId(userIdRaw);
    if (this.exists(userId)) {
      throw new ApiError(ERROR_CODES.ADM_USER_ID_TAKEN, `用户标识已存在：${userId}`);
    }
    const agents = this.normalizeAgents(agentsRaw);
    const password =
      typeof passwordRaw === 'string' && passwordRaw !== '' ? hashPassword(passwordRaw) : undefined;
    const doc: UserLinkDocument = password
      ? { user_id: userId, agents, password }
      : { user_id: userId, agents };
    const write = (): void => {
      this.store.writeJson(UserLinkService.relPath(userId), doc);
    };

    if (revision === undefined) {
      write();
      return { user_id: userId, agents, revision: this.store.bumpRevision() };
    }
    return { user_id: userId, agents, revision: this.store.withRevision(revision, write).revision };
  }

  update(userIdRaw: unknown, agentsRaw: unknown, revision: number): UserView {
    const userId = this.requireUserId(userIdRaw);
    // 保留既有密码摘要：编辑关联数字人 MUST NOT 清空密码
    const current = this.read(userId);
    const agents = this.normalizeAgents(agentsRaw);
    const next: UserLinkDocument = current.password
      ? { user_id: userId, agents, password: current.password }
      : { user_id: userId, agents };
    const { revision: nextRevision } = this.store.withRevision(revision, () => {
      this.store.writeJson(UserLinkService.relPath(userId), next);
    });
    return { user_id: userId, agents, revision: nextRevision };
  }

  /**
   * 重置密码（2026-11-18）：替换该用户的密码摘要，**保留**其关联数字人。
   *
   * 刻意独立于 `update()`：`update()` 校验并递增 `revision`（乐观锁属于"关联数字人"
   * 这条写入路径），而密码不属于部署/配置快照——重置密码若也占版本，会把别人正在
   * 编辑的关联写入无谓地打成 409。故本方法直接落盘、不触碰 `revision`。
   *
   * 明文长度由调用方（路由）校验；用户不存在 → `ADM_USER_NOT_FOUND`（`read` 负责）。
   */
  setPassword(userIdRaw: unknown, password: string): UserView {
    const userId = this.requireUserId(userIdRaw);
    const current = this.read(userId);
    this.store.writeJson(UserLinkService.relPath(userId), {
      user_id: userId,
      agents: current.agents,
      password: hashPassword(password),
    } satisfies UserLinkDocument);
    return { user_id: userId, agents: current.agents, revision: this.store.revision() };
  }

  remove(userIdRaw: unknown): void {
    const userId = this.requireUserId(userIdRaw);
    this.read(userId);
    this.store.remove(UserLinkService.relPath(userId));
    this.store.bumpRevision();
  }

  private requireUserId(raw: unknown): string {
    const userId = typeof raw === 'string' ? raw : '';
    if (!isSafeName(userId)) {
      throw new ApiError(
        ERROR_CODES.ADM_USER_ID_TAKEN,
        `用户标识非法：${JSON.stringify(raw)}（不得为空、不得含路径分隔符或 ".."）`,
      );
    }
    return userId;
  }

  /**
   * 关联数字人校验：可关联的 MUST 是**平台内已存在**的数字人（`FR-025`）。
   * 由调用方注入 `existsAgent`，避免本模块反向依赖设计态服务。
   */
  private normalizeAgents(raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'agents 须为字符串数组');
    }
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item !== 'string' || item.trim() === '') {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'agents 含空值或非字符串项');
      }
      if (out.includes(item)) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `agents 含重复项：${item}`);
      }
      out.push(item);
    }
    return out;
  }
}
