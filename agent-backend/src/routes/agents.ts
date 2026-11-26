import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { getAgentDetail, listAgents } from '../domain/agent-catalog.js';
import { resolveAgentScope } from '../domain/agent-scope.js';
import { AgentConfigError, loadAgentConfig } from '../domain/agent-instance.js';
import { getCurrentUser } from '../domain/current-user.js';
import { migrateUserDataLayout } from '../domain/data-migration.js';
import { ensureAgentDataDirs, userAgentsDir } from '../domain/dirs.js';
import type { ChatAgent } from '../infra/agent-factory.js';
import { onSseDisconnect } from '../infra/sse.js';
import { createThrottledWarn } from '../logging.js';
import { ApiError } from '../server.js';

export function registerAgentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const catalogLogger = createThrottledWarn(ctx.loggers.logger, 'agent.config.invalid');

  const mcpSnapshot = (userId: string) => {
    const selected = ctx.currentAgent.current(userId);
    if (!selected) return { agent_name: null, mcp_servers: [] as unknown[] };

    const detail = getAgentDetail(
      ctx.config.optAgentRoot,
      userId,
      selected.agentName,
      catalogLogger,
    );
    if (!detail)
      throw new ApiError(404, 'AGENT_NOT_FOUND', `数字人不存在或配置损坏：${selected.agentName}`);

    const instance = ctx.pool.get(selected) as ChatAgent | undefined;
    return {
      agent_name: selected.agentName,
      mcp_servers: detail.mcp_servers.map((s) => ({
        name: s.name,
        transport: s.transport,
        status: instance ? instance.mcpStatusOf(s.name) : 'unknown',
      })),
    };
  };

  app.get('/api/agents', async () => {
    const userId = getCurrentUser().userId;
    return listAgents(ctx.config.optAgentRoot, userId, catalogLogger);
  });

  app.get('/api/agents/current/skills', async () => {
    const userId = getCurrentUser().userId;
    const { agentName } = resolveAgentScope(ctx, userId, {
      notSelectedMessage: '请先选定数字人再查看技能',
      route: 'GET /api/agents/current/skills',
    });
    const detail = getAgentDetail(ctx.config.optAgentRoot, userId, agentName, catalogLogger);
    if (!detail) throw new ApiError(404, 'AGENT_NOT_FOUND', `数字人不存在或配置损坏：${agentName}`);
    return {
      agent_name: detail.agent_name,
      skills: detail.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),
    };
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
      if (err instanceof AgentConfigError)
        throw new ApiError(404, 'AGENT_NOT_FOUND', `数字人不存在或配置损坏：${name}`);
      throw err;
    }

    ctx.currentAgent.select(userId, name);
    // 首次选中即触发一次迁移（判定①：当前选中），把数据搬进这个数字人目录（幂等，无源即返回）。
    // **顺序不可颠倒**：迁移 MUST 早于建骨架——先把三空间骨架建出来，存量里的同名目录
    migrateUserDataLayout(ctx.config.optAgentRoot, userId, {
      currentAgentName: name,
      logger: ctx.loggers.logger,
    });
    // 选中即初始化**该数字人**的数据域骨架（3 空间 + threads，幂等）——迁移之后补齐源里缺的目录；
    ensureAgentDataDirs(ctx.config.optAgentRoot, userId, name);
    ctx.mcpEvents.emitChanged(userId);
    return { agent_name: name, selected: true };
  });

  app.post('/api/agents/current/exit', async () => {
    const userId = getCurrentUser().userId;
    const had = ctx.currentAgent.current(userId) !== undefined;
    ctx.currentAgent.exit(userId);
    ctx.mcpEvents.emitChanged(userId);
    return { exited: had };
  });

  app.get('/api/agents/current', async () => {
    const userId = getCurrentUser().userId;
    return { agent_name: ctx.currentAgent.current(userId)?.agentName ?? null };
  });

  app.get('/api/agents/current/mcp', async () => {
    const userId = getCurrentUser().userId;
    return mcpSnapshot(userId);
  });

  app.post('/api/agents/current/mcp/warm', async () => {
    const userId = getCurrentUser().userId;
    const selected = ctx.currentAgent.current(userId);
    if (!selected) return { agent_name: null, mcp_servers: [] as unknown[] };

    // `false` 是"预热没成功"的兜底值：池满 / 配置损坏时连实例都拿不到（见 catch）
    let ready = false;
    try {
      const instance =
        (ctx.pool.get(selected) as ChatAgent | undefined) ??
        (await ctx.getOrCreateAgent({ userId, agentName: selected.agentName }));
      ready = await instance.mcpReady(ctx.config.mcpConnectTimeoutMs);
    } catch (err) {
      ctx.loggers.logger.warn(
        { err, event: 'mcp.warm.failed', user_id: userId, agent_name: selected.agentName },
        'MCP 预热失败（降级为"尚无连接结果"，不阻断发消息）',
      );
    }
    if (!ready) {
      ctx.loggers.logger.warn(
        {
          event: 'mcp.warm.timeout',
          user_id: userId,
          agent_name: selected.agentName,
          timeout_ms: ctx.config.mcpConnectTimeoutMs,
        },
        'MCP 建连未在预热超时内落定，仍返回当前快照',
      );
    }
    return mcpSnapshot(userId);
  });

  app.get('/api/agents/current/mcp/events', (req, reply) => {
    const userId = getCurrentUser().userId;
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const push = (): void => {
      let snapshot: unknown;
      try {
        snapshot = mcpSnapshot(userId);
      } catch {
        // 选中数字人配置损坏等异常：推送空快照，不断开流（与 GET 端点的静默降级语义一致）
        snapshot = { agent_name: null, mcp_servers: [] };
      }
      reply.raw.write(`event: mcp-status\ndata: ${JSON.stringify(snapshot)}\n\n`);
    };

    push();
    const unsubscribe = ctx.mcpEvents.onChanged((changedUserId) => {
      if (changedUserId === userId) push();
    });
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);

    // 断连钩子必须挂响应：`req.raw` 的 close 在请求体读完时已触发过（见 infra/sse.ts）
    onSseDisconnect(reply.raw, () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });
}
