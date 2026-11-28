/**
 * 账号域 file 驱动（028 阶段 2/3）。
 *
 * 两份 JSON 集合（`.platform-data/accounts/` 下，设计态之外的新目录——
 * 账号域写不占 `meta.json` 的 revision，D4 口径）：
 * - `agent-services.json`   → `agent_services` 表
 * - `register-links.json`   → `register_links` 表
 *
 * `user-agent-grants.json` 已于 2026-11-27 彻底移除（授权 = 关联 = `users.agents[]`，
 * 见 `my-agents.ts`）：文件、路径常量、迁移脚本与迁移单测同批删除，不保留历史副本。
 *
 * 全量读入内存、写时整份落盘（账号域量级：个位到千级，整份重写成本可忽略；
 * 与 `PlatformStore` 的 JSON 写口径一致，无需引入新机制）。
 * 路径来自 `./paths.ts`（与账号主档 / 会话登记同一来源，2026-11-27 结构收敛）。
 */
import type { PlatformStore } from '../../infra/platform-store.js';
import {
  DuplicateAgentCodeError,
  nowDatetime,
  type AccountStorePort,
  type AgentServiceRecord,
  type RegisterLinkRecord,
} from './account-store.js';
// 路径唯一来源见 `./paths.ts`；本文件沿用短名，避免使用点无意义改名
import { AGENT_SERVICES_FILE as SERVICES_FILE, REGISTER_LINKS_FILE as LINKS_FILE } from './paths.js';

export class FileAccountStore implements AccountStorePort {
  private services: AgentServiceRecord[] = [];
  private links: RegisterLinkRecord[] = [];

  constructor(private readonly store: PlatformStore) {}

  async init(): Promise<void> {
    this.services = this.store.readJson<AgentServiceRecord[]>(SERVICES_FILE) ?? [];
    this.links = this.store.readJson<RegisterLinkRecord[]>(LINKS_FILE) ?? [];
  }

  /* ---- 数字人服务 ---- */

  async listAgentServices(): Promise<AgentServiceRecord[]> {
    return [...this.services];
  }

  async findAgentService(code: string): Promise<AgentServiceRecord | null> {
    return this.services.find((item) => item.code === code) ?? null;
  }

  async saveAgentService(record: AgentServiceRecord): Promise<void> {
    const index = this.services.findIndex((item) => item.code === record.code);
    const now = nowDatetime();
    if (index >= 0) {
      this.services[index] = { ...record, created_at: this.services[index]!.created_at, updated_at: now };
    } else {
      this.services.push({ ...record, created_at: now, updated_at: now });
    }
    this.store.writeJson(SERVICES_FILE, this.services);
  }

  async insertAgentService(record: AgentServiceRecord): Promise<void> {
    if (this.services.some((item) => item.code === record.code)) {
      throw new DuplicateAgentCodeError(record.code);
    }
    const now = nowDatetime();
    this.services.push({ ...record, created_at: now, updated_at: now });
    this.store.writeJson(SERVICES_FILE, this.services);
  }

  async removeAgentService(code: string): Promise<void> {
    this.services = this.services.filter((item) => item.code !== code);
    this.store.writeJson(SERVICES_FILE, this.services);
  }

  /* ---- 专属注册链接 ---- */

  async listRegisterLinks(): Promise<RegisterLinkRecord[]> {
    return [...this.links];
  }

  async findRegisterLink(token: string): Promise<RegisterLinkRecord | null> {
    return this.links.find((item) => item.token === token) ?? null;
  }

  async saveRegisterLink(record: RegisterLinkRecord): Promise<void> {
    const index = this.links.findIndex((item) => item.token === record.token);
    if (index >= 0) this.links[index] = record;
    else this.links.push(record);
    this.store.writeJson(LINKS_FILE, this.links);
  }

  async revokeLinksOf(agentCodes: string[], revokedAt: string): Promise<number> {
    const targets = new Set(agentCodes);
    let affected = 0;
    for (const link of this.links) {
      if (link.revoked_at !== null || !targets.has(link.agent_code)) continue;
      link.revoked_at = revokedAt;
      affected += 1;
    }
    if (affected > 0) this.store.writeJson(LINKS_FILE, this.links);
    return affected;
  }

  async incrementUseCount(token: string): Promise<void> {
    const link = this.links.find((item) => item.token === token);
    if (!link) return;
    link.use_count += 1;
    this.store.writeJson(LINKS_FILE, this.links);
  }
}
