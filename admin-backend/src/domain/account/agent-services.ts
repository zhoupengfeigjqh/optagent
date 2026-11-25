/**
 * 数字人服务基本信息（028 §4.4）：编码 / 名称 / 平台落点的 CRUD 与启停。
 *
 * 只管**服务目录**本身；授权语义在 `grants.ts`，注册链接在 `register-links.ts`。
 * `platform_agent_name` 与平台设计态的一致性由路由侧断言（`assertAgentsExist` 同口径）。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import {
  nowDatetime,
  type AccountStorePort,
  type AgentServiceRecord,
} from './account-store.js';

export interface AgentServiceView {
  code: string;
  name: string;
  platform_agent_name: string;
  status: 'enabled' | 'disabled';
  /** 已授权（approved）用户数 */
  registered_users: number;
  created_at: string;
  updated_at: string;
}

export class AgentServiceCatalog {
  constructor(private readonly store: AccountStorePort) {}

  async list(): Promise<AgentServiceView[]> {
    const [services, grants] = await Promise.all([
      this.store.listAgentServices(),
      this.store.listGrants(),
    ]);
    const counts = new Map<string, number>();
    for (const grant of grants) {
      if (grant.status !== 'approved') continue;
      counts.set(grant.agent_code, (counts.get(grant.agent_code) ?? 0) + 1);
    }
    return services.map((service) => ({
      code: service.code,
      name: service.name,
      platform_agent_name: service.platform_agent_name,
      status: service.status,
      registered_users: counts.get(service.code) ?? 0,
      created_at: service.created_at,
      updated_at: service.updated_at,
    }));
  }

  async requireService(code: string): Promise<AgentServiceRecord> {
    const record = await this.store.findAgentService(code);
    if (!record) {
      throw new ApiError(ERROR_CODES.ADM_AGENT_SERVICE_NOT_FOUND, `数字人服务不存在：${code}`);
    }
    return record;
  }

  async create(input: {
    code: string;
    name: string;
    platform_agent_name: string;
  }): Promise<AgentServiceView> {
    if (await this.store.findAgentService(input.code)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `数字人服务编码已存在：${input.code}（编码不可重复，也不可改）`,
      );
    }
    const record: AgentServiceRecord = {
      code: input.code,
      name: input.name,
      platform_agent_name: input.platform_agent_name,
      status: 'enabled',
      created_at: nowDatetime(),
      updated_at: nowDatetime(),
    };
    await this.store.saveAgentService(record);
    return this.toView(record, 0);
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

  /** 存在任何授权或注册链接 → `ADM_AGENT_SERVICE_IN_USE`（409，禁止删除） */
  async remove(code: string): Promise<void> {
    await this.requireService(code);
    const [links, grants] = await Promise.all([
      this.store.listRegisterLinks(),
      this.store.listGrants(),
    ]);
    if (links.some((link) => link.agent_code === code) || grants.some((g) => g.agent_code === code)) {
      throw new ApiError(
        ERROR_CODES.ADM_AGENT_SERVICE_IN_USE,
        `数字人服务 ${code} 已被注册链接或用户授权引用，禁止删除（可改为停用）`,
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
