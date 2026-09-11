/**
 * 数字人路由（US4 / T044：列表/详情只读查询；US1 已含 select/exit 选中状态）。
 *
 * - GET  /api/agents            — 列表 { agent_name, description }；配置损坏者排除并告警
 * - GET  /api/agents/:name      — 详情（soul/skills/enabled_tools/mcp_servers，不含密钥类字段）
 * - POST /api/agents/:name/select — 配置损坏 → 404；**覆盖式选中**（可随时切换，无需先 exit）；
 *   重复 select 幂等；不销毁实例、不影响进行中的 run（下一轮对话生效）
 * - POST /api/agents/current/exit — 幂等；不销毁实例（LRU + 空闲超时自然回收）
 */
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { getAgentDetail, listAgents } from '../domain/agent-catalog.js';
import { AgentConfigError, loadAgentConfig } from '../domain/agent-instance.js';
import { getCurrentUser } from '../domain/current-user.js';
import { userAgentsDir } from '../domain/dirs.js';
import type { ChatAgent } from '../infra/agent-factory.js';
import { ApiError } from '../server.js';

export function registerAgentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const catalogLogger = {
    warn: (msg: string) => ctx.loggers.logger.warn({ alert: true, event: 'agent.config.invalid' }, msg),
  };

  app.get('/api/agents', async () => {
    const userId = getCurrentUser().userId;
    return listAgents(ctx.config.optAgentRoot, userId, catalogLogger);
  });

  app.get('/api/agents/:name', async (req) => {
    const userId = getCurrentUser().userId;
    const { name } = req.params as { name: string };
    const detail = getAgentDetail(ctx.config.optAgentRoot, userId, name, catalogLogger);
    if (!detail) throw new ApiError(404, 'AGENT_NOT_FOUND', `数字人不存在或配置损坏：${name}`);
    return detail;
  });

  app.post('/api/agents/:name/select', async (req) => {
    const userId = getCurrentUser().userId;
    const { name } = req.params as { name: string };

    try {
      loadAgentConfig(path.join(userAgentsDir(ctx.config.optAgentRoot, userId), name));
    } catch (err) {
      if (err instanceof AgentConfigError) throw new ApiError(404, 'AGENT_NOT_FOUND', `数字人不存在或配置损坏：${name}`);
      throw err;
    }

    // 覆盖式选中：无需先 exit；切换后新数字人在下一轮对话生效
    ctx.currentAgent.select(userId, name);
    return { agent_name: name, selected: true };
  });

  app.post('/api/agents/current/exit', async () => {
    const userId = getCurrentUser().userId;
    const had = ctx.currentAgent.current(userId) !== undefined;
    ctx.currentAgent.exit(userId);
    return { exited: had };
  });

  // 002 US4 / FR-018：当前选中数字人查询（未选中 → agent_name: null）
  app.get('/api/agents/current', async () => {
    const userId = getCurrentUser().userId;
    return { agent_name: ctx.currentAgent.current(userId)?.agentName ?? null };
  });

  // 002 US4 / FR-019/020：当前数字人挂载的 MCP 服务清单与连接状态
  app.get('/api/agents/current/mcp', async () => {
    const userId = getCurrentUser().userId;
    const selected = ctx.currentAgent.current(userId);
    if (!selected) return { agent_name: null, mcp_servers: [] };

    const detail = getAgentDetail(ctx.config.optAgentRoot, userId, selected.agentName, catalogLogger);
    if (!detail) throw new ApiError(404, 'AGENT_NOT_FOUND', `数字人不存在或配置损坏：${selected.agentName}`);

    // 池内活跃实例 → 取实际连接结果；实例未创建（首次建连中或空闲回收后）→ 一律 failed
    const instance = ctx.pool.get(selected) as ChatAgent | undefined;
    const unavailable = new Set(instance ? instance.unavailableMcp() : []);
    return {
      agent_name: selected.agentName,
      mcp_servers: detail.mcp_servers.map((s) => ({
        name: s.name,
        transport: s.transport,
        status: instance && !unavailable.has(s.name) ? 'connected' : 'failed',
      })),
    };
  });
}
