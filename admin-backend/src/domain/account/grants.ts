/**
 * 用户 × 数字人服务授权（028 §4.2，绑定关联的唯一权威源）。
 *
 * 三态语义（与原型 `auth[rid]` 一一对应，行不存在 = 未申请）：
 * - `approved`：注册链接自动授权 / 审批通过；
 * - `pending` ：对话界面「申请」产生，进后台审批队列；
 * - `revoked`：后台关闭（**不删行**，保留审计轨迹；重建授权走 approve）。
 *
 * 注意与部署关联 `users.agents[]` 的边界（方案 §6）：本表只决定「能否使用」，
 * 部署仍由 `users.agents[]` 驱动，两者 MUST NOT 混写。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { paginate, type Paged } from '../paging.js';
import type { UserLinkPort } from '../config-center/user-links.js';
import { nowDatetime, type AccountStorePort, type GrantRecord, type GrantStatus } from './account-store.js';

export interface GrantView {
  user_id: string;
  phone: string | null;
  display_name: string | null;
  agent_code: string;
  agent_name: string;
  status: GrantStatus;
  source: GrantRecord['source'];
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface MyAgentsView {
  items: Array<{
    code: string;
    name: string;
    platform_agent_name: string;
    status: 'approved';
  }>;
  pending: Array<{ code: string; name: string; platform_agent_name: string }>;
}

export class GrantService {
  constructor(
    private readonly store: AccountStorePort,
    private readonly users: UserLinkPort,
  ) {}

  /**
   * 申请（对话界面「切换数字人 → 申请」）：
   * `approved` / `pending` 幂等；无记录或 `revoked` →（重）置 `pending`。
   */
  async apply(userId: string, agentCode: string): Promise<GrantRecord> {
    const service = await this.store.findAgentService(agentCode);
    if (!service) {
      throw new ApiError(ERROR_CODES.ADM_AGENT_SERVICE_NOT_FOUND, `数字人服务不存在：${agentCode}`);
    }
    const existing = await this.store.findGrant(userId, agentCode);
    if (existing && (existing.status === 'approved' || existing.status === 'pending')) {
      return existing;
    }
    const now = nowDatetime();
    const record: GrantRecord = {
      user_id: userId,
      agent_code: agentCode,
      status: 'pending',
      source: 'apply',
      reviewed_by: null,
      reviewed_at: null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await this.store.saveGrant(record);
    return record;
  }

  /** 审批通过（pending/revoked → approved；记审批人与时间） */
  async approve(userId: string, agentCode: string, reviewer: string | null): Promise<GrantRecord> {
    const existing = await this.mustFind(userId, agentCode);
    const now = nowDatetime();
    const record: GrantRecord = {
      ...existing,
      status: 'approved',
      reviewed_by: reviewer,
      reviewed_at: now,
      updated_at: now,
    };
    await this.store.saveGrant(record);
    return record;
  }

  /** 关闭授权（approved/pending → revoked；不删行，保留审计轨迹） */
  async revoke(userId: string, agentCode: string, reviewer: string | null): Promise<GrantRecord> {
    const existing = await this.mustFind(userId, agentCode);
    const now = nowDatetime();
    const record: GrantRecord = {
      ...existing,
      status: 'revoked',
      reviewed_by: reviewer,
      reviewed_at: now,
      updated_at: now,
    };
    await this.store.saveGrant(record);
    return record;
  }

  /** 授权总账 / 审批队列（管理员）：按状态 / 服务 / 手机号过滤 + 卡片分页 */
  async list(filter: {
    status?: GrantStatus | undefined;
    agentCode?: string | undefined;
    phone?: string | undefined;
    page: number;
  }): Promise<Paged<GrantView>> {
    const [grants, services] = await Promise.all([this.store.listGrants(), this.store.listAgentServices()]);
    const names = new Map(services.map((service) => [service.code, service.name]));
    const byUser = new Map(this.users.listAll().map((doc) => [doc.user_id, doc]));

    const phoneLower = filter.phone?.trim().toLowerCase() ?? '';
    const views = grants
      .filter((grant) => !filter.status || grant.status === filter.status)
      .filter((grant) => !filter.agentCode || grant.agent_code === filter.agentCode)
      .filter((grant) => {
        if (phoneLower === '') return true;
        const doc = byUser.get(grant.user_id);
        return (doc?.phone ?? '').toLowerCase().includes(phoneLower);
      })
      .map((grant) => {
        const doc = byUser.get(grant.user_id);
        return {
          user_id: grant.user_id,
          phone: doc?.phone ?? null,
          display_name: doc?.display_name ?? null,
          agent_code: grant.agent_code,
          agent_name: names.get(grant.agent_code) ?? grant.agent_code,
          status: grant.status,
          source: grant.source,
          created_at: grant.created_at,
          reviewed_at: grant.reviewed_at,
          reviewed_by: grant.reviewed_by,
        };
      });
    return paginate(views, filter.page);
  }

  /** 当前用户已授权 / 待审批清单（`revoked` 不下发） */
  async myAgents(userId: string): Promise<MyAgentsView> {
    const [grants, services] = await Promise.all([this.store.listGrants(), this.store.listAgentServices()]);
    const byCode = new Map(services.map((service) => [service.code, service]));
    const mine = grants.filter((grant) => grant.user_id === userId);
    const approved = mine
      .filter((grant) => grant.status === 'approved')
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return {
      items: approved.map((grant) => {
        const service = byCode.get(grant.agent_code);
        return {
          code: grant.agent_code,
          name: service?.name ?? grant.agent_code,
          platform_agent_name: service?.platform_agent_name ?? grant.agent_code,
          status: 'approved' as const,
        };
      }),
      pending: mine
        .filter((grant) => grant.status === 'pending')
        .map((grant) => {
          const service = byCode.get(grant.agent_code);
          return {
            code: grant.agent_code,
            name: service?.name ?? grant.agent_code,
            platform_agent_name: service?.platform_agent_name ?? grant.agent_code,
          };
        }),
    };
  }

  /** 全体用户的授权摘要（`GET /users` 卡片用）：user_id → `{ approved, pending }` */
  async summaries(): Promise<Map<string, { approved: number; pending: number }>> {
    const grants = await this.store.listGrants();
    const out = new Map<string, { approved: number; pending: number }>();
    for (const grant of grants) {
      const summary = out.get(grant.user_id) ?? { approved: 0, pending: 0 };
      if (grant.status === 'approved') summary.approved += 1;
      if (grant.status === 'pending') summary.pending += 1;
      out.set(grant.user_id, summary);
    }
    return out;
  }

  /** 删除用户时级联清理其授权（file 驱动必须显式做；mysql 由 FK CASCADE 兜底） */
  async removeAllOfUser(userId: string): Promise<void> {
    await this.store.removeGrantsOfUser(userId);
  }

  private async mustFind(userId: string, agentCode: string): Promise<GrantRecord> {
    const existing = await this.store.findGrant(userId, agentCode);
    if (!existing) {
      throw new ApiError(
        ERROR_CODES.ADM_GRANT_NOT_FOUND,
        `授权记录不存在：用户 ${userId} × 服务 ${agentCode}（可先由用户发起申请）`,
      );
    }
    return existing;
  }
}
