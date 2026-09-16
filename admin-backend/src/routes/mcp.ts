/**
 * MCP 服务路由（`contracts/admin-api.md` §3.1~§3.8）。
 *
 * 清单来源是**容器编排声明**（`FR-043`），平台 MUST NOT 要求二次登记。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import { agentsReferencingService } from '../domain/config-center/references.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import { normalizeLimit, normalizePage, paginate } from '../domain/paging.js';
import { LOGS_LIMIT_DEFAULT, LOGS_LIMIT_MAX } from '../domain/mcp/operations.js';
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
    await assertKnown(deps, name);

    const { config, revision } = ctx.mcpConfigs.upsert(name, body, body.revision);
    return {
      name: config.name,
      description: config.description,
      transport: config.transport,
      endpoints: config.endpoints,
      file_args: config.file_args,
      revision,
      affected_agents: agentsReferencingService(ctx.agents.refSources(), name),
    };
  });

  app.post('/api/admin/mcp/services/:name/start', async (req) => {
    const { name } = req.params as { name: string };
    return deps.operations.start(name);
  });

  app.post('/api/admin/mcp/services/:name/stop', async (req) => {
    const { name } = req.params as { name: string };
    return deps.operations.stop(name);
  });

  app.post('/api/admin/mcp/services/:name/test', async (req) => {
    const { name } = req.params as { name: string };
    // body 可选：携带表单当前值时按未保存的值探测（FR-047 的"测的是谁"必须可见）
    const body = (req.body ?? {}) as Record<string, unknown>;
    return deps.operations.test(name, body);
  });

  app.get('/api/admin/mcp/services/:name/logs', async (req) => {
    const { name } = req.params as { name: string };
    const query = (req.query ?? {}) as { limit?: unknown };
    const limit = normalizeLimit(query.limit, LOGS_LIMIT_DEFAULT, LOGS_LIMIT_MAX);
    return deps.operations.logs(name, limit);
  });

  /** §3.8 调用统计（`FR-049`）；不可达时 `stats_available: false`，**不以 0 冒充** */
  app.get('/api/admin/mcp/stats', async () => deps.operations.stats());
}

/** 启停/配置前先确认服务真实存在（编排声明或平台配置中） */
async function assertKnown(deps: McpRoutesDeps, name: string): Promise<void> {
  const views = await deps.serviceList.list();
  if (!views.some((view) => view.name === name)) {
    throw new ApiError(
      ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND,
      `MCP 服务不存在（既不在容器编排声明中，也没有平台侧配置）：${name}`,
    );
  }
}
