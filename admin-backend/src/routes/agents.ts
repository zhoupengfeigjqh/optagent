/**
 * 数字人设计路由（`contracts/admin-api.md` §5.1~§5.5）。
 *
 * - `GET    /api/admin/agents`         — 卡片列表（名称 + 用途描述 + 异常态）
 * - `POST   /api/admin/agents`         — 新建
 * - `GET    /api/admin/agents/{name}`  — 详情（全部配置内容）
 * - `PUT    /api/admin/agents/{name}`  — 编辑任意一类配置并保存
 * - `DELETE /api/admin/agents/{name}`  — 删除（被用户关联时阻止）
 */
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

  /**
   * 设计器候选目录（2026-10-17，契约 §5.6）。
   *
   * 数字人设计器需要**全量**候选（内置工具 / MCP 服务 / SKILL），而三者的卡片列表
   * 接口固定 8 条一页（`paging.ts`，服务端写死且不接受客户端覆盖）。设计器此前直接取
   * `page=1`，于是库里第 9 个 SKILL / MCP 服务在界面上**根本选不到**，也没有任何提示。
   *
   * 本端点一次返回全部候选，不参与分页；卡片列表自身行为不变。
   *
   * 降级口径与 `snapshot()` 一致：内置工具不可达时只清空 `builtin_tools` 并带回原因
   * （设计器据此提示"保存含工具的配置会被拒绝"），MCP 与 SKILL 候选照常返回。
   */
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

    // 本体（`FR-058`，2026-10-17）：设计器第四类引用。候选**就是 metadata 列表**——
    // 身份只有一份来源（scenario_name / ontology_name），正文由部署物化时从库内取
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
    // FR-021：被用户关联时 MUST 阻止直接删除，或要求先显式解除关联
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
