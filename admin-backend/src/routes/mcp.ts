import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import { agentsReferencingService } from '../domain/config-center/references.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import { normalizePage, paginate } from '../domain/paging.js';
import { maskHeaders } from '../domain/mcp/service-config-fields.js';
import type { McpServiceListService } from '../domain/mcp/service-list.js';
import type { McpServiceOperations } from '../domain/mcp/operations.js';

export interface McpRoutesDeps {
  serviceList: McpServiceListService;
  operations: McpServiceOperations;
}

export function registerMcpRoutes(app: FastifyInstance, ctx: AppContext, deps: McpRoutesDeps): void {
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

  app.post('/api/admin/mcp/probe', async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return deps.operations.probe(body);
  });

  app.post('/api/admin/mcp/services', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const revision = typeof body.revision === 'number' ? body.revision : undefined;
    ctx.mcpConfigs.validateForCreate(body);
    await deps.operations.assertReachable(body);
    const { config, revision: nextRevision } = ctx.mcpConfigs.create(body, revision);
    return reply
      .status(201)
      .send({ ...toConfigResponse(config), revision: nextRevision, affected_agents: [] });
  });

  app.put('/api/admin/mcp/services/:name', async (req) => {
    const { name } = req.params as { name: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.revision !== 'number' || !Number.isInteger(body.revision)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'revision 必填且须为整数（乐观锁）');
    }

    const { config, revision } = ctx.mcpConfigs.upsert(name, body, body.revision);
    // 否则客户端拿响应回填时会丢字段（2026-09-25 实测：command/args 漏登）
    return {
      ...toConfigResponse(config),
      revision,
      affected_agents: agentsReferencingService(ctx.agents.refSources(), name),
    };
  });

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

function toConfigResponse(config: {
  name: string;
  description: string;
  transport: 'http' | 'stdio';
  url: string | null;
  command: string | null;
  args: string[] | null;
  file_args: Record<string, Record<string, string>>;
  rules_fields: Record<string, string>;
  confirmation: 'never' | 'always' | { tools: string[] };
  allowed_tools: string[];
  tool_labels: Record<string, string>;
  headers: Record<string, string>;
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
    confirmation: config.confirmation,
    // 白名单必须回显：界面对照"数字人能看到什么"，漏登会让它凭空消失
    allowed_tools: config.allowed_tools,
    // 工具显示名同样必须回显：详情会覆盖表单，漏登 = "保存一次就清空"
    tool_labels: config.tool_labels,
    // 请求头同样必须回显（界面要看出"配了令牌"），但**只回掩码**——
    headers: maskHeaders(config.headers),
    updated_at: config.updated_at,
  };
}
