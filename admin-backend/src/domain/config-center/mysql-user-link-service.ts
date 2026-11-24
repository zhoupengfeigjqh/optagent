/**
 * 账号域 MySQL 实现（028 特性，阶段 1）。
 *
 * 结构：`MysqlUserRepository`（内存投影 + SQL 写透）+ `MysqlUserLinkService`
 * （`UserLinkPort` 的 mysql 实现，编排/校验与 file 版一致）。
 *
 * 读同步、写异步的口径（方案 §8.3 的代价收敛）：
 * - **内存投影**：`init()` 全量加载 `users` 表，此后所有读走内存——
 *   `Deployer` / `references.ts` / MCP 引用查询等同步消费方**零改动**；
 * - **写透**：写方法先 SQL 落库，成功后更新投影；失败即抛可读错误
 *   （不静默回退，宪章"按 STORAGE_DRIVER 明确报错"）；
 * - **revision**：账号域写不占设计态版本（D4），响应里的 revision 为
 *   `PlatformStore` 只读快照。
 */
import { ApiError } from '../api-error.js';
import { hashPassword, type PasswordRecord } from '../auth/password.js';
import { ERROR_CODES } from '../error-codes.js';
import { paginate, type Paged } from '../paging.js';
import type { PlatformStore } from '../../infra/platform-store.js';
import { isDuplicateEntry, type MysqlConnection } from '../../infra/mysql.js';
import {
  normalizeAgents,
  requireUserId,
  type UserLinkDocument,
  type UserLinkPort,
  type UserView,
} from './user-links.js';

/** `users` 表中本仓储关心的列（其余列由阶段 2/3 的注册链路使用） */
interface UserRow {
  user_id: string;
  agents: unknown;
  password_record: unknown;
}

export class MysqlUserRepository {
  private readonly docs = new Map<string, UserLinkDocument>();

  constructor(private readonly conn: MysqlConnection) {}

  /** 启动期全量加载内存投影（wiring 时调用；失败 = 服务拒绝启动） */
  async init(): Promise<void> {
    const rows = await this.conn.select<UserRow>('SELECT user_id, agents, password_record FROM users');
    this.docs.clear();
    for (const row of rows) {
      this.docs.set(row.user_id, toDocument(row));
    }
  }

  listAll(): UserLinkDocument[] {
    return [...this.docs.values()].sort((a, b) => a.user_id.localeCompare(b.user_id, 'zh-Hans-CN'));
  }

  exists(userId: string): boolean {
    return this.docs.has(userId);
  }

  readOrNull(userId: string): UserLinkDocument | null {
    return this.docs.get(userId) ?? null;
  }

  /** 落库成功后更新投影（upsert：`uk_users_user_id` 命中即更新 agents 与密码摘要） */
  async save(doc: UserLinkDocument): Promise<void> {
    try {
      await this.conn.modify(
        `INSERT INTO users (user_id, agents, password_record)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE agents = VALUES(agents), password_record = VALUES(password_record)`,
        [doc.user_id, JSON.stringify(doc.agents), doc.password ? JSON.stringify(doc.password) : null],
      );
    } catch (err) {
      if (isDuplicateEntry(err)) {
        throw new ApiError(ERROR_CODES.ADM_USER_ID_TAKEN, `用户标识已存在：${doc.user_id}`);
      }
      throw err;
    }
    this.docs.set(doc.user_id, doc);
  }

  async remove(userId: string): Promise<void> {
    await this.conn.modify('DELETE FROM users WHERE user_id = ?', [userId]);
    this.docs.delete(userId);
  }
}

/** 行 → 领域文档（JSON 列可能已被驱动解析，也可能仍是字符串，两种都兼容） */
function toDocument(row: UserRow): UserLinkDocument {
  const agents = parseJsonColumn(row.agents, 'agents');
  if (!Array.isArray(agents) || agents.some((a) => typeof a !== 'string')) {
    throw new ApiError(
      ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
      `账号库数据损坏：用户 ${row.user_id} 的 agents 不是字符串数组`,
    );
  }
  const doc: UserLinkDocument = { user_id: row.user_id, agents };
  const password = row.password_record === null ? null : parseJsonColumn(row.password_record, 'password_record');
  if (password !== null && typeof password === 'object') {
    doc.password = password as PasswordRecord;
  }
  return doc;
}

function parseJsonColumn(value: unknown, column: string): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new ApiError(ERROR_CODES.ADM_STORAGE_UNAVAILABLE, `账号库 JSON 列损坏：${column}`);
  }
}

export class MysqlUserLinkService implements UserLinkPort {
  constructor(
    private readonly repo: MysqlUserRepository,
    /** 仅用于读取设计态 revision（响应字段口径），不参与账号写入 */
    private readonly store: PlatformStore,
  ) {}

  /** 启动期加载（wiring 时调用） */
  async init(): Promise<void> {
    await this.repo.init();
  }

  listAll(): UserLinkDocument[] {
    return this.repo.listAll();
  }

  exists(userId: string): boolean {
    return this.repo.exists(userId);
  }

  readOrNull(userId: string): UserLinkDocument | null {
    return this.repo.readOrNull(userId);
  }

  read(userId: string): UserLinkDocument {
    const doc = this.readOrNull(userId);
    if (!doc) throw new ApiError(ERROR_CODES.ADM_USER_NOT_FOUND, `用户不存在：${userId}`);
    return doc;
  }

  usersOfAgent(agentName: string): string[] {
    return this.listAll()
      .filter((user) => user.agents.includes(agentName))
      .map((user) => user.user_id);
  }

  list(page: number, toItem: (user: UserLinkDocument) => unknown): Paged<unknown> {
    return paginate(this.listAll().map(toItem), page);
  }

  async create(
    userIdRaw: unknown,
    agentsRaw: unknown,
    revision: number | undefined,
    passwordRaw: unknown | undefined,
  ): Promise<UserView> {
    const userId = requireUserId(userIdRaw);
    if (this.repo.exists(userId)) {
      throw new ApiError(ERROR_CODES.ADM_USER_ID_TAKEN, `用户标识已存在：${userId}`);
    }
    const agents = normalizeAgents(agentsRaw);
    const password =
      typeof passwordRaw === 'string' && passwordRaw !== '' ? hashPassword(passwordRaw) : undefined;
    const doc: UserLinkDocument = password
      ? { user_id: userId, agents, password }
      : { user_id: userId, agents };
    await this.repo.save(doc);
    // D4：账号域写不占设计态版本；`revision` 入参仅 file 驱动有意义，这里忽略
    return { user_id: userId, agents, revision: this.store.revision() };
  }

  async update(userIdRaw: unknown, agentsRaw: unknown, _revision: number): Promise<UserView> {
    const userId = requireUserId(userIdRaw);
    const current = this.read(userId);
    const agents = normalizeAgents(agentsRaw);
    const next: UserLinkDocument = current.password
      ? { user_id: userId, agents, password: current.password }
      : { user_id: userId, agents };
    await this.repo.save(next);
    return { user_id: userId, agents, revision: this.store.revision() };
  }

  /** 与 file 版同口径：不触碰设计态 revision，密码不属于配置快照 */
  async setPassword(userIdRaw: unknown, password: string): Promise<UserView> {
    const userId = requireUserId(userIdRaw);
    const current = this.read(userId);
    await this.repo.save({ user_id: userId, agents: current.agents, password: hashPassword(password) });
    return { user_id: userId, agents: current.agents, revision: this.store.revision() };
  }

  async remove(userIdRaw: unknown): Promise<void> {
    const userId = requireUserId(userIdRaw);
    this.read(userId);
    await this.repo.remove(userId);
  }
}
