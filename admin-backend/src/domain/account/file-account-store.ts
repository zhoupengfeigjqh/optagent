/**
 * 账号域 file 驱动（028 阶段 2/3）。
 *
 * 三份 JSON 集合（`.platform-data/accounts/` 下，设计态之外的新目录——
 * 账号域写不占 `meta.json` 的 revision，D4 口径）：
 * - `agent-services.json`   → `agent_services` 表
 * - `register-links.json`   → `register_links` 表
 * - `user-agent-grants.json`→ `user_agent_grants` 表
 *
 * 全量读入内存、写时整份落盘（账号域量级：个位到千级，整份重写成本可忽略；
 * 与 `PlatformStore` 的 JSON 写口径一致，无需引入新机制）。
 */
import type { PlatformStore } from '../../infra/platform-store.js';
import {
  nowDatetime,
  type AccountStorePort,
  type AgentServiceRecord,
  type GrantRecord,
  type RegisterLinkRecord,
} from './account-store.js';

const ACCOUNTS_DIR = 'accounts';
const SERVICES_FILE = `${ACCOUNTS_DIR}/agent-services.json`;
const LINKS_FILE = `${ACCOUNTS_DIR}/register-links.json`;
const GRANTS_FILE = `${ACCOUNTS_DIR}/user-agent-grants.json`;

export class FileAccountStore implements AccountStorePort {
  private services: AgentServiceRecord[] = [];
  private links: RegisterLinkRecord[] = [];
  private grants: GrantRecord[] = [];

  constructor(private readonly store: PlatformStore) {}

  async init(): Promise<void> {
    this.services = this.store.readJson<AgentServiceRecord[]>(SERVICES_FILE) ?? [];
    this.links = this.store.readJson<RegisterLinkRecord[]>(LINKS_FILE) ?? [];
    this.grants = this.store.readJson<GrantRecord[]>(GRANTS_FILE) ?? [];
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

  /* ---- 授权 ---- */

  async listGrants(): Promise<GrantRecord[]> {
    return [...this.grants];
  }

  async findGrant(userId: string, agentCode: string): Promise<GrantRecord | null> {
    return this.grants.find((item) => item.user_id === userId && item.agent_code === agentCode) ?? null;
  }

  async saveGrant(record: GrantRecord): Promise<void> {
    const index = this.grants.findIndex(
      (item) => item.user_id === record.user_id && item.agent_code === record.agent_code,
    );
    if (index >= 0) this.grants[index] = record;
    else this.grants.push(record);
    this.store.writeJson(GRANTS_FILE, this.grants);
  }

  async removeGrantsOfUser(userId: string): Promise<void> {
    this.grants = this.grants.filter((item) => item.user_id !== userId);
    this.store.writeJson(GRANTS_FILE, this.grants);
  }
}
