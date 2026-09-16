/**
 * 用户与关联数字人路由（`contracts/admin-api.md` §6.1~§6.4）。
 *
 * 该页兼作**部署前核对总账**（`FR-023`）：用户卡片可展开看到每个数字人的
 * 搭配摘要（引用的 MCP 服务、内置工具、SKILL）及其异常标记，
 * 并在卡片上显示**部署状态**（`deployed_at`，取自部署清单；`null` = 尚未部署）。
 * 部署对象就在这一页勾选（2026-09-16 十一次调整）。
 *
 * `DELETE` 只删平台侧用户，**不删除** `.opt-agent/` 中该用户的数据目录
 * （受 `FR-028` 约束）；实际清理由后续"部署生效"按部署清单语义决定。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import { anomalyReason, detectAnomalies } from '../domain/config-center/references.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import { normalizePage } from '../domain/paging.js';

export function registerUserRoutes(app: FastifyInstance, ctx: AppContext): void {
  async function resolveIndex() {
    return (await ctx.catalog.snapshot()).index;
  }

  app.get('/api/admin/users', async (req) => {
    const query = (req.query ?? {}) as { page?: unknown; expand?: unknown };
    const page = normalizePage(query.page);
    const withSummary = query.expand === 'summary';
    const index = await resolveIndex();

    return ctx.users.list(page, (user) => {
      const agents = user.agents.map((name) => {
        const design = ctx.agents.readOrNull(name);
        if (!design) {
          return { name, abnormal: true, abnormal_reason: `数字人 ${name} 的设计态缺失` };
        }
        const anomalies = detectAnomalies(design, index);
        return { name, abnormal: anomalies.length > 0, abnormal_reason: anomalyReason(anomalies) };
      });

      return {
        user_id: user.user_id,
        agents,
        // 部署状态取自部署清单：`null` 表示"从未部署过"（新建用户即如此）
        deployed_at: ctx.manifest.get(user.user_id)?.last_deployed_at ?? null,
        summary: withSummary
          ? user.agents.map((name) => {
              const design = ctx.agents.readOrNull(name);
              return {
                name,
                mcp_services: design?.mcp_services ?? [],
                enabled_tools: design?.enabled_tools ?? [],
                skills: design?.skills ?? [],
              };
            })
          : null,
      };
    });
  });

  app.post('/api/admin/users', async (req, reply) => {
    const body = (req.body ?? {}) as { user_id?: unknown; agents?: unknown; revision?: unknown };
    assertAgentsExist(ctx, body.agents);
    const revision = typeof body.revision === 'number' ? body.revision : undefined;
    const view = ctx.users.create(body.user_id, body.agents, revision);
    return reply.status(201).send(view);
  });

  app.put('/api/admin/users/:user_id', async (req) => {
    const { user_id: userId } = req.params as { user_id: string };
    const body = (req.body ?? {}) as { agents?: unknown; revision?: unknown };
    if (typeof body.revision !== 'number' || !Number.isInteger(body.revision)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'revision 必填且须为整数（乐观锁）');
    }
    assertAgentsExist(ctx, body.agents);
    return ctx.users.update(userId, body.agents, body.revision);
  });

  app.delete('/api/admin/users/:user_id', async (req, reply) => {
    const { user_id: userId } = req.params as { user_id: string };
    ctx.users.remove(userId);
    return reply.status(204).send();
  });
}

/** `FR-025`：可关联的 MUST 是平台内**已存在**的数字人 */
function assertAgentsExist(ctx: AppContext, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  const missing = raw.filter(
    (name): name is string => typeof name === 'string' && !ctx.agents.exists(name),
  );
  if (missing.length > 0) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `关联了不存在的数字人：${missing.join('、')}（可关联的只能是平台内已存在的数字人）`,
    );
  }
}
