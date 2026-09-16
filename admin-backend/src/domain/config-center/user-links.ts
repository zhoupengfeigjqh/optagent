/**
 * 用户与其关联数字人（`FR-023`~`FR-025`，`data-model.md` §6）。
 *
 * **注意区分两个"用户"概念**（`research.md` D11）：本实体是**平台的业务使用者**
 * （如 `admin`，会被分配数字人），与平台操作者 `zyw_admin`（仅用于审计字段）
 * 是**两个不同概念**，MUST NOT 混用。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { paginate, type Paged } from '../paging.js';
import type { PlatformStore } from '../../infra/platform-store.js';
import { isSafeName } from './agent-design.js';

const USERS_DIR = 'users';

export interface UserLinkDocument {
  user_id: string;
  agents: string[];
}

export interface UserView extends UserLinkDocument {
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

  create(userIdRaw: unknown, agentsRaw: unknown, revision?: number): UserView {
    const userId = this.requireUserId(userIdRaw);
    if (this.exists(userId)) {
      throw new ApiError(ERROR_CODES.ADM_USER_ID_TAKEN, `用户标识已存在：${userId}`);
    }
    const agents = this.normalizeAgents(agentsRaw);
    const write = (): void => {
      this.store.writeJson(UserLinkService.relPath(userId), { user_id: userId, agents });
    };

    if (revision === undefined) {
      write();
      return { user_id: userId, agents, revision: this.store.bumpRevision() };
    }
    return { user_id: userId, agents, revision: this.store.withRevision(revision, write).revision };
  }

  update(userIdRaw: unknown, agentsRaw: unknown, revision: number): UserView {
    const userId = this.requireUserId(userIdRaw);
    this.read(userId);
    const agents = this.normalizeAgents(agentsRaw);
    const { revision: nextRevision } = this.store.withRevision(revision, () => {
      this.store.writeJson(UserLinkService.relPath(userId), { user_id: userId, agents });
    });
    return { user_id: userId, agents, revision: nextRevision };
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
