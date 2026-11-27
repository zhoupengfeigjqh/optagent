/**
 * 账号域 MySQL 实现（028 特性，阶段 1；阶段 2 扩展账号字段）。
 *
 * 结构：`MysqlUserRepository`（内存投影 + SQL 写透）+ `MysqlUserLinkService`
 * （`UserLinkPort` 的 mysql 实现，编排/校验与 file 版一致）。
 *
 * 读同步、写异步的口径（方案 §8.3 的代价收敛）：
 * - **内存投影**：`init()` 全量加载 `users` 表，此后所有读走内存——
 *   `Deployer` / `references.ts` / MCP 引用查询等同步消费方**零改动**；
 * - **写透**：写方法先 SQL 落库，成功后更新投影；失败即抛可读错误
 *   （不静默回退，宪章"按 STORAGE_DRIVER 明确报错"）；
 * - `revision`：账号域写不占设计态版本（D4），响应里的 revision 为
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
  toView,
  type UserLinkDocument,
  type UserLinkPort,
  type UserProfileInput,
  type UserView,
} from './user-links.js';

/** `users` 表中本仓储关心的列 */
interface UserRow {
  user_id: string;
  phone: string | null;
  agents: unknown;
  display_name: unknown;
  password_record: unknown;
  role: unknown;
  source_agent_code: string | null;
}

export class MysqlUserRepository {
  private readonly docs = new Map<string, UserLinkDocument>();

  constructor(private readonly conn: MysqlConnection) {}

  /** 启动期全量加载内存投影（wiring 时调用；失败 = 服务拒绝启动） */
  async init(): Promise<void> {
    const rows = await this.conn.select<UserRow>(
      'SELECT user_id, phone, agents, display_name, password_record, role, source_agent_code FROM users',
    );
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

  /** 落库成功后更新投影（upsert：`uk_users_user_id` 命中即更新全量账号列） */
  async save(doc: UserLinkDocument): Promise<void> {
    try {
      await this.conn.modify(
        `INSERT INTO users (user_id, phone, agents, display_name, password_record, role, source_agent_code)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           phone = VALUES(phone),
           agents = VALUES(agents),
           display_name = VALUES(display_name),
           password_record = VALUES(password_record),
           role = VALUES(role),
           source_agent_code = VALUES(source_agent_code)`,
        [
          doc.user_id,
          doc.phone ?? null,
          JSON.stringify(doc.agents),
          doc.display_name ?? '',
          doc.password ? JSON.stringify(doc.password) : null,
          doc.role ?? 'user',
          doc.source_agent_code ?? null,
        ],
      );
    } catch (err) {
      if (isDuplicateEntry(err)) {
        // 命中的唯一键：user_id → ADM_USER_ID_TAKEN；phone → ADM_PHONE_TAKEN
        if (String((err as Error).message).includes('phone')) {
          throw new ApiError(ERROR_CODES.ADM_PHONE_TAKEN, `手机号已被注册：${doc.phone ?? ''}`);
        }
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
  if (row.phone !== null && row.phone !== '') doc.phone = row.phone;
  if (typeof row.display_name === 'string' && row.display_name !== '') {
    doc.display_name = row.display_name;
  }
  const password = row.password_record === null ? null : parseJsonColumn(row.password_record, 'password_record');
  if (password !== null && typeof password === 'object') {
    doc.password = password as PasswordRecord;
  }
  if (row.role === 'admin') doc.role = 'admin';
  if (row.source_agent_code !== null && row.source_agent_code !== '') {
    doc.source_agent_code = row.source_agent_code;
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

  findByPhone(phone: string): UserLinkDocument | null {
    return this.listAll().find((doc) => doc.phone === phone) ?? null;
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
    profile?: UserProfileInput,
  ): Promise<UserView> {
    const userId = requireUserId(userIdRaw);
    if (this.repo.exists(userId)) {
      throw new ApiError(ERROR_CODES.ADM_USER_ID_TAKEN, `用户标识已存在：${userId}`);
    }
    if (profile?.phone && this.findByPhone(profile.phone)) {
      throw new ApiError(ERROR_CODES.ADM_PHONE_TAKEN, `手机号已被注册：${profile.phone}`);
    }
    const agents = normalizeAgents(agentsRaw);
    const password =
      typeof passwordRaw === 'string' && passwordRaw !== '' ? hashPassword(passwordRaw) : undefined;
    const doc: UserLinkDocument = { user_id: userId, agents };
    if (password) doc.password = password;
    if (profile?.phone) doc.phone = profile.phone;
    if (profile?.display_name) doc.display_name = profile.display_name;
    if (profile?.role) doc.role = profile.role;
    if (profile?.source_agent_code) doc.source_agent_code = profile.source_agent_code;
    await this.repo.save(doc);
    // D4：账号域写不占设计态版本；`revision` 入参仅 file 驱动有意义，这里忽略
    return toView(userId, agents, this.store.revision(), doc);
  }

  async update(userIdRaw: unknown, agentsRaw: unknown, _revision: number): Promise<UserView> {
    const userId = requireUserId(userIdRaw);
    const current = this.read(userId);
    const agents = normalizeAgents(agentsRaw);
    const next: UserLinkDocument = { ...current, user_id: userId, agents };
    await this.repo.save(next);
    return toView(userId, agents, this.store.revision(), next);
  }

  /** 与 file 版同口径：不触碰设计态 revision，密码不属于配置快照 */
  async setPassword(userIdRaw: unknown, password: string): Promise<UserView> {
    const userId = requireUserId(userIdRaw);
    const current = this.read(userId);
    const next: UserLinkDocument = { ...current, password: hashPassword(password) };
    await this.repo.save(next);
    return toView(userId, current.agents, this.store.revision(), next);
  }

  async remove(userIdRaw: unknown): Promise<void> {
    const userId = requireUserId(userIdRaw);
    this.read(userId);
    await this.repo.remove(userId);
  }
}
