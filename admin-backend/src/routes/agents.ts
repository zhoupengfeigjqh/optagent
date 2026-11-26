import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import { UnifiedCatalog, type CatalogSnapshot } from '../domain/config-center/unified-catalog.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import { normalizePage } from '../domain/paging.js';
import type { BuiltinToolProjection } from '../infra/runtime-client.js';

export function registerAgentRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** 取统一清单快照，并按"是否引用内置工具"决定工具目录是否必须可得 */
  async function snapshotFor(enabledTools: readonly string[]): Promise<CatalogSnapshot> {
    const snapshot = await ctx.catalog.snapshot();
    UnifiedCatalog.assertToolsAvailableFor(snapshot.toolsUnavailableReason, enabledTools);
    return snapshot;
  }

  app.get('/api/admin/agents/catalog', async () => {
    let builtinTools: BuiltinToolProjection[] = [];
    let builtinToolsError: string | null = null;
    try {
      builtinTools = await ctx.catalog.builtinTools();
    } catch (err) {
      builtinToolsError = err instanceof ApiError ? err.message : `运行环境不可达：${(err as Error).message}`;
    }

    const [mcpServices, skills] = await Promise.all([
      ctx.mcpServices.list(),
      Promise.resolve(ctx.skills.listAll()),
    ]);

    const ontologies = ctx.ontologies.listAll().map((item) => ({ metadata: item.metadata }));

    return {
      builtin_tools: builtinTools,
      builtin_tools_error: builtinToolsError,
      mcp_services: mcpServices,
      skills,
      ontologies,
    };
  });

  app.get('/api/admin/agents', async (req) => {
    const query = (req.query ?? {}) as { page?: unknown };
    const page = normalizePage(query.page);
    const { index } = await ctx.catalog.snapshot();
    return ctx.agents.list(page, index);
  });

  app.post('/api/admin/agents', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const enabledTools = Array.isArray(body.enabled_tools) ? (body.enabled_tools as string[]) : [];
    const { index } = await snapshotFor(enabledTools);
    const revision = typeof body.revision === 'number' ? body.revision : undefined;
    const view = ctx.agents.create(body, index, revision);
    return reply.status(201).send(view);
  });

  app.get('/api/admin/agents/:name', async (req) => {
    const { name } = req.params as { name: string };
    const { index } = await ctx.catalog.snapshot();
    return ctx.agents.view(name, index);
  });

  app.put('/api/admin/agents/:name', async (req) => {
    const { name } = req.params as { name: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.revision !== 'number' || !Number.isInteger(body.revision)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'revision 必填且须为整数（乐观锁）');
    }
    const enabledTools = Array.isArray(body.enabled_tools) ? (body.enabled_tools as string[]) : [];
    const { index } = await snapshotFor(enabledTools);
    return ctx.agents.update(name, body, index, body.revision);
  });

  app.delete('/api/admin/agents/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const linkedUsers = ctx.users.usersOfAgent(name);
    if (linkedUsers.length > 0) {
      throw new ApiError(
        ERROR_CODES.ADM_AGENT_IN_USE,
        `数字人 ${name} 已被用户关联（${linkedUsers.join('、')}），请先解除关联再删除`,
      );
    }
    ctx.agents.remove(name);
    return reply.status(204).send();
  });
}
