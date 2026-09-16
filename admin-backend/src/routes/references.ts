/**
 * 派生信息路由（`contracts/admin-api.md` §7.1、§7.2）。
 *
 * 规格关键实体「引用关系」明确：引用关系**不落库**、**不做常驻浏览视图**；
 * 呈现时机**仅限**破坏性操作的确认环节、部署前校验与全局异常项汇总。
 * 因此本节接口 MUST NOT 被任何常驻页面轮询调用——§7.1 只在管理员
 * **触发删除/关闭之后**才由界面调用。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import {
  agentsReferencingService,
  agentsReferencingSkill,
  agentsReferencingTool,
  collectAnomalies,
  expandToPairs,
} from '../domain/config-center/references.js';
import type { AgentRefSource } from '../domain/config-center/references.js';

const TARGET_TYPES = ['builtin_tool', 'mcp_service', 'skill', 'agent', 'user'] as const;
type TargetType = (typeof TARGET_TYPES)[number];

export function registerReferenceRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** §7.1 引用关系（仅供破坏性操作的确认环节调用） */
  app.get('/api/admin/references', async (req) => {
    const query = (req.query ?? {}) as { target_type?: unknown; target_name?: unknown };
    const targetType = query.target_type;
    const targetName = query.target_name;

    if (typeof targetType !== 'string' || !(TARGET_TYPES as readonly string[]).includes(targetType)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `target_type 必填，且须为 ${TARGET_TYPES.join(' | ')} 之一`,
      );
    }
    if (typeof targetName !== 'string' || targetName.trim() === '') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'target_name 必填且不能为空');
    }

    const sources = ctx.agents.refSources();
    const users = ctx.users.listAll().map((user) => ({ user_id: user.user_id, agents: [...user.agents] }));

    const affected = resolveAffectedPairs(targetType as TargetType, targetName, sources, users);
    return { target_type: targetType, target_name: targetName, affected };
  });

  /** §7.2 全局异常项汇总（落在部署功能区内；有界返回） */
  app.get('/api/admin/anomalies', async (req) => {
    const query = (req.query ?? {}) as { limit?: unknown };
    const limit = normalizeAnomalyLimit(query.limit);

    const snapshot = await ctx.catalog.snapshot();
    const sources = ctx.agents.refSources();
    const users = ctx.users.listAll().map((user) => ({ user_id: user.user_id, agents: [...user.agents] }));
    const all = collectAnomalies(sources, users, snapshot.index);
    const items = all.slice(0, limit);

    return {
      items,
      total: all.length,
      truncated: items.length < all.length,
      // 前端可直接使用的编辑跳转路径模板，避免前端硬编码路由（原则七）
      edit_path: '/agents/{agent_name}?tab={category}',
    };
  });
}

function normalizeAnomalyLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 50;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `limit 须为 ≥1 的整数（当前：${String(raw)}）`);
  }
  return Math.min(value, 200);
}

/**
 * 受影响的「用户 × 数字人」对。
 *
 * `builtin_tool` / `mcp_service` / `skill` / `agent` 是**跨用户**的对象：
 * 影响面要展开到全部引用了它的用户。而 `user` 本身就是用户维度，
 * 只应列出**该用户自己的**关联——展开到其他用户会把"别的用户也用了同一个
 * 数字人"误报成"删除这个用户会影响别人"。
 */
function resolveAffectedPairs(
  targetType: TargetType,
  targetName: string,
  sources: AgentRefSource[],
  users: Array<{ user_id: string; agents: string[] }>,
): Array<{ user_id: string; agent_name: string }> {
  switch (targetType) {
    case 'builtin_tool':
      return expandToPairs(agentsReferencingTool(sources, targetName), users);
    case 'mcp_service':
      return expandToPairs(agentsReferencingService(sources, targetName), users);
    case 'skill':
      return expandToPairs(agentsReferencingSkill(sources, targetName), users);
    case 'agent':
      return expandToPairs([targetName], users);
    case 'user': {
      const user = users.find((item) => item.user_id === targetName);
      return (user?.agents ?? []).map((agent) => ({ user_id: targetName, agent_name: agent }));
    }
    default:
      return [];
  }
}
