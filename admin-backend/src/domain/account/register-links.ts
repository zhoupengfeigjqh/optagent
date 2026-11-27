/**
 * 专属注册链接（028 §4.3）：生成 / 列表 / 软撤销 / 公开校验 / 注册计数。
 *
 * 有效性口径（`schema.sql` 的 `idx_register_links_valid` 同款）：
 * `revoked_at IS NULL` 且（`expires_at IS NULL` 或晚于当前时间）且服务 `enabled`。
 * 公开校验失败一律 `ADM_INVALID_LINK`（不枚举原因——避免探测有效 token）。
 */
import { randomBytes } from 'node:crypto';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import {
  datetimeAfter,
  isExpired,
  nowDatetime,
  type AccountStorePort,
  type AgentServiceRecord,
  type RegisterLinkRecord,
} from './account-store.js';

export interface RegisterLinkView {
  token: string;
  agent_code: string;
  agent_name: string;
  expires_at: string | null;
  revoked_at: string | null;
  use_count: number;
  created_by: string | null;
  created_at: string;
}

/** 注册链接的公开校验结果（注册页渲染用） */
export interface LinkLookupResult {
  agent: AgentServiceRecord;
}

export class RegisterLinkService {
  constructor(
    private readonly store: AccountStorePort,
    private readonly config: {
      /** 新链接默认有效期（秒）；`null` = 长期有效 */
      defaultTtlSeconds: number | null;
      /** 注册页前缀（如 `http://host/register`）；空串时使用前台默认路由 `/register` */
      publicBaseUrl: string;
    },
  ) {}

  async list(agentCode?: string): Promise<RegisterLinkView[]> {
    const [links, services] = await Promise.all([
      this.store.listRegisterLinks(),
      this.store.listAgentServices(),
    ]);
    const names = new Map(services.map((service) => [service.code, service.name]));
    return links
      .filter((link) => !agentCode || link.agent_code === agentCode)
      .map((link) => ({
        token: link.token,
        agent_code: link.agent_code,
        agent_name: names.get(link.agent_code) ?? link.agent_code,
        expires_at: link.expires_at,
        revoked_at: link.revoked_at,
        use_count: link.use_count,
        created_by: link.created_by,
        created_at: link.created_at,
      }));
  }

  async create(input: {
    agentCode: string;
    /** 有效期（秒）；缺省用配置默认；`null` 明确表示长期有效 */
    expiresIn?: number | null | undefined;
    createdBy?: string | null | undefined;
  }): Promise<RegisterLinkRecord> {
    const service = await this.store.findAgentService(input.agentCode);
    if (!service) {
      throw new ApiError(ERROR_CODES.ADM_AGENT_SERVICE_NOT_FOUND, `数字人服务不存在：${input.agentCode}`);
    }
    if (service.status === 'disabled') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `数字人服务已停用：${input.agentCode}`);
    }
    const ttl = input.expiresIn === undefined ? this.config.defaultTtlSeconds : input.expiresIn;
    const record: RegisterLinkRecord = {
      token: await this.uniqueToken(),
      agent_code: input.agentCode,
      created_by: input.createdBy ?? null,
      expires_at: ttl === null ? null : datetimeAfter(ttl),
      revoked_at: null,
      use_count: 0,
      created_at: nowDatetime(),
    };
    await this.store.saveRegisterLink(record);
    return record;
  }

  /** 软撤销（幂等：已撤销保持原时间戳） */
  async revoke(token: string): Promise<void> {
    const link = await this.store.findRegisterLink(token);
    if (!link) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, `注册链接不存在：${token}`);
    }
    if (link.revoked_at !== null) return;
    await this.store.saveRegisterLink({ ...link, revoked_at: nowDatetime() });
  }

  /**
   * 公开校验（注册页 / 注册提交共用）：无效 / 过期 / 撤销 / 服务停用
   * 一律 `ADM_INVALID_LINK`（400，不枚举）。
   */
  async lookup(token: string): Promise<LinkLookupResult> {
    const link = await this.store.findRegisterLink(token);
    if (!link || link.revoked_at !== null || isExpired(link.expires_at)) {
      throw new ApiError(ERROR_CODES.ADM_INVALID_LINK, '注册链接无效或已过期');
    }
    const service = await this.store.findAgentService(link.agent_code);
    if (!service || service.status === 'disabled') {
      throw new ApiError(ERROR_CODES.ADM_INVALID_LINK, '注册链接无效或已过期');
    }
    return { agent: service };
  }

  /** 注册成功后计数 +1（幂等约束由注册链路保证只调一次） */
  async consume(token: string): Promise<void> {
    const link = await this.store.findRegisterLink(token);
    if (!link) return;
    await this.store.saveRegisterLink({ ...link, use_count: link.use_count + 1 });
  }

  /** 注册页可直接访问的完整 URL（携带 token 的 query） */
  urlOf(token: string): string {
    const base = (this.config.publicBaseUrl || '/register').replace(/\/+$/, '');
    return `${base}?link=${encodeURIComponent(token)}`;
  }

  private async uniqueToken(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const token = randomBytes(24).toString('base64url');
      if (!(await this.store.findRegisterLink(token))) return token;
    }
    // 24 字节随机串 8 连撞 = 天文数字概率；到这说明存储层异常
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '生成注册链接失败（随机 token 冲突）');
  }
}
