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
import { maskHeaders } from '../domain/mcp/service-config-fields.js';
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
   * §3.9 新建前的**工具清单探测**（2026-10-03）。
   *
   * 对**尚未登记**的连接目标连一次取回工具清单——新建流程据此让管理员勾选"可见工具"
   * （`allowed_tools`）。与 §3.6 的分工：`test` 只回答"已登记服务通不通"，
   * 本端点回答"这个新目标有哪些工具"，因此不要求服务已存在。
   *
   * 连接失败时 **HTTP 200 + `ok: false` + 可读原因**（失败要留在弹窗里，不是页级报错）；
   * 目标写法非法（transport/url）仍是 400。
   */
  app.post('/api/admin/mcp/probe', async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return deps.operations.probe(body);
  });

  /**
   * §3.3 新建 MCP 服务（2026-09-27；2026-10-03 起要求工具白名单）。
   *
   * 名称由管理员指定且**全局唯一**（重名 → `ADM_MCP_SERVICE_EXISTS`）；
   * `allowed_tools` **必填非空**（白名单创建后不可改，见 §3.3 的 `PUT` 说明）。
   * `revision` 可选（带了即做乐观锁校验），响应即"新建后的完整调用配置"。
   *
   * **硬门槛（2026-10-03 产品决定）**：先确认目标**连得上**再落盘——连不上即创建失败，
   * 库里**不产生记录**（避免留下一个"没有工具范围"、等价于全部放行的服务）。
   */
  app.post('/api/admin/mcp/services', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const revision = typeof body.revision === 'number' ? body.revision : undefined;
    // ① 纯字段校验先行（重名 / 名称 / 白名单非空 / 地址写法）：为注定失败的新建省掉一次连接
    ctx.mcpConfigs.validateForCreate(body);
    // ② 连得上才落盘（失败抛 `ADM_RUNTIME_UNREACHABLE`/`VALIDATION_FAILED`，此时尚未写盘）
    await deps.operations.assertReachable(body);
    const { config, revision: nextRevision } = ctx.mcpConfigs.create(body, revision);
    return reply.status(201).send({ ...toConfigResponse(config), revision: nextRevision, affected_agents: [] });
  });

  /**
   * §3.3 保存调用配置（`FR-044`）。
   * 修改 MUST **自动作用于所有引用它的数字人**（下次部署生效），
   * 因此响应里带上 `affected_agents` 让界面明确告知影响面。
   *
   * **工具白名单不在此端点修改**（2026-10-03）：携带 `allowed_tools` 即
   * `ADM_MCP_TOOL_SCOPE_LOCKED`——白名单只在新建时设定，容器范围要看数字人能看到什么。
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
  allowed_tools: string[];
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
    async_tools: config.async_tools,
    confirmation: config.confirmation,
    // 白名单必须回显：界面对照"数字人能看到什么"，漏登会让它凭空消失
    allowed_tools: config.allowed_tools,
    // 请求头同样必须回显（界面要看出"配了令牌"），但**只回掩码**——
    // 明文令牌不进任何响应（与详情接口同一口径，见 `maskHeaders`）
    headers: maskHeaders(config.headers),
    updated_at: config.updated_at,
  };
}
