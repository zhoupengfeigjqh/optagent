/**
 * 授权路由（028 §4.2）：申请 / 审批 / 关闭 / 总账。
 *
 * - `POST /api/admin/grants/apply`：**本人**——`user_id` 取自会话，不放请求体（防越权）；
 * - `GET  /api/admin/grants`：授权总账 / 审批队列（按状态 / 服务 / 手机号过滤）；
 * - `POST /api/admin/grants/approve` / `POST /api/admin/grants/revoke`：管理员操作。
 *
 * 管理端点的角色强制校验按 D8 后置到阶段 4（`ADMIN_AUTH_ENABLED` 开关），
 * 与既有接口"暂无全局鉴权"的现状一致。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import type { GrantStatus } from '../domain/account/account-store.js';
import { normalizeAgentCode } from '../domain/account/account-store.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import { normalizePage } from '../domain/paging.js';
import { requireLogin } from './auth.js';

function normalizeStatusFilter(raw: unknown): GrantStatus | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (raw !== 'pending' && raw !== 'approved' && raw !== 'revoked') {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `status 只支持 pending / approved / revoked（当前：${String(raw)}）`,
    );
  }
  return raw;
}

function requireBodyUserId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'user_id 必填');
  }
  return raw.trim();
}

export function registerGrantRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/admin/grants', async (req) => {
    const q = (req.query ?? {}) as { status?: unknown; agent_code?: unknown; phone?: unknown; page?: unknown };
    const status = normalizeStatusFilter(q.status);
    const agentCode =
      typeof q.agent_code === 'string' && q.agent_code.trim() !== ''
        ? normalizeAgentCode(q.agent_code)
        : undefined;
    const phone = typeof q.phone === 'string' ? q.phone : undefined;
    return ctx.grants.list({ status, agentCode, phone, page: normalizePage(q.page) });
  });

  /** 本人申请（幂等）：`user_id` 取自会话，不放请求体（防越权） */
  app.post('/api/admin/grants/apply', async (req) => {
    const userId = await requireLogin(req, ctx);
    const body = (req.body ?? {}) as { agent_code?: unknown };
    const agentCode = normalizeAgentCode(body.agent_code);
    const grant = await ctx.grants.apply(userId, agentCode);
    return { user_id: grant.user_id, agent_code: grant.agent_code, status: grant.status };
  });

  /** 审批通过：pending/revoked → approved（记审批人与时间） */
  app.post('/api/admin/grants/approve', async (req) => {
    const body = (req.body ?? {}) as { user_id?: unknown; agent_code?: unknown };
    const userId = requireBodyUserId(body.user_id);
    const agentCode = normalizeAgentCode(body.agent_code);
    const grant = await ctx.grants.approve(userId, agentCode, null);
    return { user_id: grant.user_id, agent_code: grant.agent_code, status: grant.status };
  });

  /** 关闭授权：approved/pending → revoked（不删行，保留审计轨迹） */
  app.post('/api/admin/grants/revoke', async (req) => {
    const body = (req.body ?? {}) as { user_id?: unknown; agent_code?: unknown };
    const userId = requireBodyUserId(body.user_id);
    const agentCode = normalizeAgentCode(body.agent_code);
    const grant = await ctx.grants.revoke(userId, agentCode, null);
    return { user_id: grant.user_id, agent_code: grant.agent_code, status: grant.status };
  });
}
