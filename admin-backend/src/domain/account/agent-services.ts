/**
 * 数字人服务基本信息（028 §4.4）：编码 / 名称 / 平台落点的 CRUD 与启停。
 *
 * 只管**服务目录**本身；授权在 `users.agents[]`（2026-11-27 起与关联合并，
 * 见 `my-agents.ts`），注册链接在 `register-links.ts`。
 * `platform_agent_name` 与平台设计态的一致性由路由侧断言（`assertAgentsExist` 同口径）。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import type { UserLinkPort } from '../config-center/user-links.js';
import { generateAgentCode } from './agent-code.js';
import {
  DuplicateAgentCodeError,
  normalizeAgentCode,
  nowDatetime,
  type AccountStorePort,
  type AgentServiceRecord,
  type RegisterLinkRecord,
} from './account-store.js';

/** 生成路径下"插入撞码 → 换码再试"的上限（并发窗口极窄，3 次足够） */
const GENERATED_CODE_INSERT_ATTEMPTS = 3;

export interface AgentServiceView {
  code: string;
  name: string;
  platform_agent_name: string;
  status: 'enabled' | 'disabled';
  /** 已关联该数字人的用户数（授权 = 关联） */
  registered_users: number;
  created_at: string;
  updated_at: string;
}

export class AgentServiceCatalog {
  constructor(
    private readonly store: AccountStorePort,
    private readonly users: UserLinkPort,
  ) {}

  async list(): Promise<AgentServiceView[]> {
    const services = await this.store.listAgentServices();
    return services.map((service) => ({
      code: service.code,
      name: service.name,
      platform_agent_name: service.platform_agent_name,
      status: service.status,
      registered_users: this.registeredCountOf(service.platform_agent_name),
      created_at: service.created_at,
      updated_at: service.updated_at,
    }));
  }

  /** 该落点被多少用户关联（`registered_users` 的唯一口径，list / create / ensure 共用） */
  private registeredCountOf(platformAgentName: string): number {
    return this.users
      .listAll()
      .filter((user) => user.agents.includes(platformAgentName)).length;
  }

  async requireService(code: string): Promise<AgentServiceRecord> {
    const record = await this.store.findAgentService(code);
    if (!record) {
      throw new ApiError(ERROR_CODES.ADM_AGENT_SERVICE_NOT_FOUND, `数字人服务不存在：${code}`);
    }
    return record;
  }

  /** 新建数字人服务（`code` 可选，语义见 `createAgentServiceRecord`） */
  async create(input: {
    code?: string | undefined;
    name: string;
    platform_agent_name: string;
  }): Promise<AgentServiceView> {
    const record = await createAgentServiceRecord(this.store, input);
    return this.toView(record, this.registeredCountOf(record.platform_agent_name));
  }

  /**
   * 预生成一个未被占用的服务编码（**只生成、不落库**）。
   *
   * 供「先落设计态、再开通服务」的创建流程使用：设计态的 `code` MUST 与
   * `agent_services.code` 同源同值，因此路由必须在 `agents.create` 之前拿到编码。
   * 生成与落库之间被并发抢占属极端情况，由插入撞码重试兜住（见 `insertWithGeneratedCode`）。
   */
  async generateCode(): Promise<string> {
    return generateAgentCode({
      isTaken: async (candidate) => (await this.store.findAgentService(candidate)) !== null,
    });
  }

  /**
   * 保证某数字人已开通服务（**1:1**，幂等）。
   *
   * 「创建/复制数字人」时调用：已存在就原样返回，绝不覆盖人工改过的名称或启停状态
   * （包括既有编码——它 MAY 与 `code` 参数不同，调用方 MUST 以返回值为准）。
   * 不存在时按传入的 `code` 开通；省略则由平台生成。
   */
  async ensureForAgent(platformAgentName: string, code?: string): Promise<AgentServiceView> {
    const record = await ensureAgentServiceFor(this.store, platformAgentName, code);
    return this.toView(record, this.registeredCountOf(platformAgentName));
  }

  /**
   * 撤掉某数字人的服务（删除数字人时级联），避免留下指向已删数字人的悬空编码。
   *
   * 语义（2026-11-27 收敛）：删除数字人 = **整体下线**，其编码下未撤销的注册链接
   * MUST 一并**软撤销**（写 `revoked_at`，记录保留以供审计），MUST NOT 因此阻断删除。
   * 链接行不物理删除；单独删除服务（`remove`）仍保留 409 语义。
   * 返回被删掉的服务数与被级联撤销的链接数。
   */
  async removeForAgent(
    platformAgentName: string,
  ): Promise<{ removed: boolean; revokedLinks: number }> {
    const services = (await this.store.listAgentServices()).filter(
      (item) => item.platform_agent_name === platformAgentName,
    );
    if (services.length === 0) return { removed: false, revokedLinks: 0 };
    // 1:1 是目标形态，但存量可能因手工建过而出现多条：级联时一并撤，避免留下悬空编码
    const codes = new Set(services.map((item) => item.code));
    const revokedLinks = await this.revokeActiveLinks(codes);
    for (const service of services) await this.store.removeAgentService(service.code);
    return { removed: true, revokedLinks };
  }

  /**
   * 删除前影响面（确认弹窗用）：该数字人的服务编码与被级联撤销的链接数。
   *
   * 与 `removeForAgent` 共用同一判据（`activeLinksOf`），避免"弹窗说到 2 条、
   * 实际撤销 3 条"这类两套口径的偏差。
   */
  async deletionImpact(
    platformAgentName: string,
  ): Promise<{ code: string | null; activeLinks: number }> {
    const services = (await this.store.listAgentServices()).filter(
      (item) => item.platform_agent_name === platformAgentName,
    );
    if (services.length === 0) return { code: null, activeLinks: 0 };
    const codes = new Set(services.map((item) => item.code));
    const active = await this.activeLinksOf(codes);
    return { code: services[0]?.code ?? null, activeLinks: active.length };
  }

  /** 某组服务编码下**未撤销**的链接（过期与否不看——过期但未撤销的仍会被级联撤销） */
  private async activeLinksOf(codes: ReadonlySet<string>): Promise<RegisterLinkRecord[]> {
    const links = await this.store.listRegisterLinks();
    return links.filter((link) => codes.has(link.agent_code) && link.revoked_at === null);
  }

  /** 级联软撤销：一次取时间戳，保证同批链接的 `revoked_at` 一致（便于按批次审计） */
  private async revokeActiveLinks(codes: ReadonlySet<string>): Promise<number> {
    const active = await this.activeLinksOf(codes);
    const revokedAt = nowDatetime();
    for (const link of active) {
      await this.store.saveRegisterLink({ ...link, revoked_at: revokedAt });
    }
    return active.length;
  }

  /** 改名称 / 启停；`code` 与 `platform_agent_name` 不可改（绑定落点稳定） */
  async update(
    code: string,
    patch: { name?: string; status?: 'enabled' | 'disabled' },
  ): Promise<AgentServiceView> {
    const current = await this.requireService(code);
    const next: AgentServiceRecord = {
      ...current,
      name: patch.name ?? current.name,
      status: patch.status ?? current.status,
      updated_at: nowDatetime(),
    };
    await this.store.saveAgentService(next);
    const [view] = (await this.list()).filter((item) => item.code === code);
    return view ?? this.toView(next, 0);
  }

  /**
   * 存在**未撤销**的注册链接或用户关联 → `ADM_AGENT_SERVICE_IN_USE`（409，禁止删除）。
   *
   * 判据与 `activeLinksOf` 同源（2026-11-27 统一）：已撤销 / 已过期的链接不再算引用，
   * 否则会出现「影响面说 0 条、删除却 409」的两套口径。
   */
  async remove(code: string): Promise<void> {
    const service = await this.requireService(code);
    const inUse =
      (await this.activeLinksOf(new Set([code]))).length > 0 ||
      this.users.listAll().some((user) => user.agents.includes(service.platform_agent_name));
    if (inUse) {
      throw new ApiError(
        ERROR_CODES.ADM_AGENT_SERVICE_IN_USE,
        `数字人服务 ${code} 已被注册链接或用户关联引用，禁止删除（可改为停用）`,
      );
    }
    await this.store.removeAgentService(code);
  }

  private toView(record: AgentServiceRecord, registeredUsers: number): AgentServiceView {
    return {
      code: record.code,
      name: record.name,
      platform_agent_name: record.platform_agent_name,
      status: record.status,
      registered_users: registeredUsers,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }
}

/* ---------------- 记录级实现（目录方法与存量补齐脚本共用，原则二：唯一来源） ---------------- */

/**
 * 创建服务记录。
 *
 * `code`（2026-11-27 起可选）：
 * - **省略 / 空串** → 平台生成（`DH-` + 5 位去混淆 Base32，见 `agent-code.ts`）；
 *   调用方 MUST 以返回值为准，MUST NOT 自行拼接或假设；
 * - **显式提供** → 走 `normalizeAgentCode` 校验（导入或指定 `DH-BOM001` 这类可读语义码），
 *   校验失败 400、撞码 400。
 *
 * 创建是**插入**语义（`insertAgentService`）：撞码 MUST 失败，MUST NOT 覆盖既有服务；
 * 生成路径若在"查重"与"插入"之间被并发抢占，换码重试（有界），不静默改写别人。
 */
export async function createAgentServiceRecord(
  store: AccountStorePort,
  input: { code?: string | undefined; name: string; platform_agent_name: string },
): Promise<AgentServiceRecord> {
  const requested = input.code === undefined ? '' : normalizeAgentCode(input.code, 'code');
  if (requested === '') return insertWithGeneratedCode(store, input);

  if (await store.findAgentService(requested)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `数字人服务编码已存在：${requested}（编码不可重复，也不可改）`,
    );
  }
  const record = buildServiceRecord(requested, input);
  try {
    await store.insertAgentService(record);
  } catch (err) {
    if (err instanceof DuplicateAgentCodeError) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `数字人服务编码已存在：${requested}（编码不可重复，也不可改）`,
      );
    }
    throw err;
  }
  return record;
}

/**
 * 保证某数字人已开通服务（**1:1**，幂等，供创建数字人路由与存量补齐脚本共用）。
 *
 * 已存在则原样返回（不覆盖名称/状态/编码）；不存在则开通一条，`name` 与 `platform_agent_name`
 * 都取数字人名——名称可由管理员后续单独改名，落点（`platform_agent_name`）不可改。
 * `code` 仅在**新建**时生效；既有服务的编码永远以登记簿为准。
 */
export async function ensureAgentServiceFor(
  store: AccountStorePort,
  platformAgentName: string,
  code?: string,
): Promise<AgentServiceRecord> {
  const existing = (await store.listAgentServices()).find(
    (item) => item.platform_agent_name === platformAgentName,
  );
  if (existing) return existing;
  return createAgentServiceRecord(store, {
    ...(code === undefined ? {} : { code }),
    name: platformAgentName,
    platform_agent_name: platformAgentName,
  });
}

/** 生成编码并插入；撞码换码重试，耗尽后按平台内部错误上报（不是调用方输入问题） */
async function insertWithGeneratedCode(
  store: AccountStorePort,
  input: { name: string; platform_agent_name: string },
): Promise<AgentServiceRecord> {
  let lastDuplicate: string | null = null;
  for (let attempt = 0; attempt < GENERATED_CODE_INSERT_ATTEMPTS; attempt += 1) {
    const code = await generateAgentCode({
      isTaken: async (candidate) => (await store.findAgentService(candidate)) !== null,
    });
    const record = buildServiceRecord(code, input);
    try {
      await store.insertAgentService(record);
      return record;
    } catch (err) {
      if (!(err instanceof DuplicateAgentCodeError)) throw err;
      lastDuplicate = err.code;
    }
  }
  throw new ApiError(
    ERROR_CODES.INTERNAL_ERROR,
    `数字人服务编码生成失败（${lastDuplicate ?? '未知编码'} 连续被占用），请重试`,
  );
}

function buildServiceRecord(
  code: string,
  input: { name: string; platform_agent_name: string },
): AgentServiceRecord {
  return {
    code,
    name: input.name,
    platform_agent_name: input.platform_agent_name,
    status: 'enabled',
    created_at: nowDatetime(),
    updated_at: nowDatetime(),
  };
}
