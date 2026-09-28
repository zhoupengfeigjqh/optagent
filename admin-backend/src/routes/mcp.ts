/**
 * MCP 服务路由（`contracts/admin-api.md` §3.1~§3.6）。
 *
 * **2026-09-27 改版（全人工配置）**：清单来源是**平台侧调用配置**
 * （平台是唯一权威源），因此：
 * - 新增 `POST /api/admin/mcp/services`（新建）与 `DELETE /api/admin/mcp/services/{name}`（删除）；
 * - **移除** `POST /{name}/start`、`POST /{name}/stop`、`GET /{name}/logs`
 *   （启停与运行日志随"不读容器运行态"整体下架）。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import { agentsReferencingService } from '../domain/config-center/references.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import { normalizePage, paginate } from '../domain/paging.js';
import type { McpServiceListService } from '../domain/mcp/service-list.js';
import type { McpServiceOperations } from '../domain/mcp/operations.js';

export interface McpRoutesDeps {
  serviceList: McpServiceListService;
  operations: McpServiceOperations;
}

export function registerMcpRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  deps: McpRoutesDeps,
): void {
  app.get('/api/admin/mcp/services', async (req) => {
    const query = (req.query ?? {}) as { page?: unknown };
    const page = normalizePage(query.page);
    const items = await deps.serviceList.list();
    return paginate(items, page);
  });

  app.get('/api/admin/mcp/services/:name', async (req) => {
    const { name } = req.params as { name: string };
    const detail = await deps.serviceList.detail(name);
    if (!detail) {
      throw new ApiError(ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND, `MCP 服务不存在：${name}`);
    }
    return detail;
  });

  /**
   * §3.3 新建 MCP 服务（2026-09-27）。
   * 名称由管理员指定且**全局唯一**（重名 → `ADM_MCP_SERVICE_EXISTS`）；
   * `revision` 可选（带了即做乐观锁校验），响应即"新建后的完整调用配置"。
   */
  app.post('/api/admin/mcp/services', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const revision = typeof body.revision === 'number' ? body.revision : undefined;
    const { config, revision: nextRevision } = ctx.mcpConfigs.create(body, revision);
    return reply.status(201).send({ ...toConfigResponse(config), revision: nextRevision, affected_agents: [] });
  });

  /**
   * §3.3 保存调用配置（`FR-044`）。
   * 修改 MUST **自动作用于所有引用它的数字人**（下次部署生效），
   * 因此响应里带上 `affected_agents` 让界面明确告知影响面。
   */
  app.put('/api/admin/mcp/services/:name', async (req) => {
    const { name } = req.params as { name: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.revision !== 'number' || !Number.isInteger(body.revision)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'revision 必填且须为整数（乐观锁）');
    }

    const { config, revision } = ctx.mcpConfigs.upsert(name, body, body.revision);
    // 契约 §3.3 + §0.5 原则 ②：响应 MUST 是"保存后的**完整**调用配置"——
    // 界面据此原地更新 `revision`、不再二次请求详情。新增字段同样要在这里登记，
    // 否则客户端拿响应回填时会丢字段（2026-09-25 实测：command/args 漏登）
    return {
      ...toConfigResponse(config),
      revision,
      affected_agents: agentsReferencingService(ctx.agents.refSources(), name),
    };
  });

  /**
   * 删除 MCP 服务（2026-09-27）。
   *
   * 被数字人引用时**不阻止删除**，但界面 MUST 先经 §7.1 引用查询列出受影响清单
   * 并二次确认（原 `FR-051` 的"关闭前提示引用"能力迁移到删除上）。
   */
  app.delete('/api/admin/mcp/services/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const revision = typeof body.revision === 'number' ? body.revision : undefined;
    ctx.mcpConfigs.remove(name, revision);
    return reply.status(204).send();
  });

  app.post('/api/admin/mcp/services/:name/test', async (req) => {
    const { name } = req.params as { name: string };
    // body 可选：携带表单当前值时按未保存的值探测（FR-047 的"测的是谁"必须可见）
    const body = (req.body ?? {}) as Record<string, unknown>;
    return deps.operations.test(name, body);
  });

  /** §3.8 调用统计（`FR-049`）；不可达时 `stats_available: false`，**不以 0 冒充** */
  app.get('/api/admin/mcp/stats', async () => deps.operations.stats());
}

/** 调用配置的响应形状（保存/新建共用，字段与前端类型一一对应） */
function toConfigResponse(config: {
  name: string;
  description: string;
  transport: 'http' | 'stdio';
  url: string | null;
  command: string | null;
  args: string[] | null;
  file_args: Record<string, Record<string, string>>;
  rules_fields: Record<string, string>;
  async_tools: string[];
  confirmation: 'never' | 'always' | { tools: string[] };
  updated_at: string;
}): Record<string, unknown> {
  return {
    name: config.name,
    description: config.description,
    transport: config.transport,
    url: config.url,
    command: config.command,
    args: config.args,
    file_args: config.file_args,
    rules_fields: config.rules_fields,
    async_tools: config.async_tools,
    confirmation: config.confirmation,
    updated_at: config.updated_at,
  };
}
