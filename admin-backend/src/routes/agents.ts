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
    // 编码由平台（调用方）生成后先写进设计态：设计态 `code` 与 `agent_services.code`
    // 同源同值，且**不接受客户端提交**（`AgentInputRaw` 不含 code）。
    const code = await ctx.agentServices.generateCode();
    let view = ctx.agents.create(body, index, revision, code);
    // 数字人 ⇔ 服务 1:1（2026-11-27）：新建/复制即开通服务，卡片据此显示 code。
    // 开通失败不回滚设计态（回滚会丢掉用户刚填的内容）；记日志，由补齐脚本修复。
    try {
      const service = await ctx.agentServices.ensureForAgent(view.name, code);
      // 该落点已有服务（如上次删除只撤了设计态）：以登记簿编码为准回写设计态，
      // 否则注册链接会指向一个没人用的新编码。
      if (service.code !== view.code) view = ctx.agents.alignCode(view.name, service.code, index);
    } catch (err) {
      req.log.error({ err, agent: view.name }, '数字人服务自动开通失败，等待补齐脚本修复');
    }
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

  /**
   * 删除前影响面（`FR-021` 增强，2026-11-27）：确认弹窗据此提示
   * 「本次删除会有 N 条注册链接失效」，并提前告知"被用户关联则删不掉"。
   *
   * 判定与 `DELETE` 同源（都走 `agentServices`），前端不自行计算。
   */
  app.get('/api/admin/agents/:name/deletion-impact', async (req) => {
    const { name } = req.params as { name: string };
    ctx.agents.read(name);
    const impact = await ctx.agentServices.deletionImpact(name);
    return {
      name,
      code: impact.code,
      linked_users: ctx.users.usersOfAgent(name),
      active_register_links: impact.activeLinks,
    };
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
    // 服务与数字人 1:1：先撤服务，再删设计态。顺序是刻意的——可失败的一步放在前面，
    // 避免"设计态已删、编码还悬空"的中间态。
    // 整体下线语义（2026-11-27）：编码下未撤销的注册链接**级联软撤销**（记录保留），
    // 不再以 409 阻断删除；条数写进审计日志，事后可查"这次删掉了多少条链接"。
    const removal = await ctx.agentServices.removeForAgent(name);
    ctx.agents.remove(name);
    if (removal.revokedLinks > 0) {
      req.log.info(
        { event: 'agent.delete.links_revoked', agent: name, revoked_links: removal.revokedLinks },
        `删除数字人 ${name}：${removal.revokedLinks} 条注册链接已级联撤销`,
      );
    }
    return reply.status(204).send();
  });
}
