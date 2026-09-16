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
import { createThrottledWarn } from '../logging.js';
import { ApiError } from '../server.js';

export function registerAgentRoutes(app: FastifyInstance, ctx: AppContext): void {
  // 目录是"每次请求现扫现解析"，配置损坏时会**每个请求告警一次** → 同一消息按窗口合并
  const catalogLogger = createThrottledWarn(ctx.loggers.logger, 'agent.config.invalid');

  /** 当前选中数字人的 MCP 状态快照（GET 轮询端点与 SSE 推送共用同一计算） */
  const mcpSnapshot = (userId: string) => {
    const selected = ctx.currentAgent.current(userId);
    if (!selected) return { agent_name: null, mcp_servers: [] as unknown[] };

    const detail = getAgentDetail(ctx.config.optAgentRoot, userId, selected.agentName, catalogLogger);
    if (!detail) throw new ApiError(404, 'AGENT_NOT_FOUND', `数字人不存在或配置损坏：${selected.agentName}`);

    // 池内活跃实例 → 取实际连接结果（connected/failed，建连进行中为 unknown）；
    // 实例未创建（首次建连前或空闲回收后）→ 尚无连接结果，一律 unknown，不误报为断线（FR-019/020）
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
    // 快照随选中变化 → 通知 SSE 订阅方推送新数字人的 MCP 状态
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

  // 002 US4 / FR-018：当前选中数字人查询（未选中 → agent_name: null）
  app.get('/api/agents/current', async () => {
    const userId = getCurrentUser().userId;
    return { agent_name: ctx.currentAgent.current(userId)?.agentName ?? null };
  });

  // 002 US4 / FR-019/020：当前数字人挂载的 MCP 服务清单与连接状态
  app.get('/api/agents/current/mcp', async () => {
    const userId = getCurrentUser().userId;
    return mcpSnapshot(userId);
  });

  /**
   * MCP 状态推送（SSE）：替代前端轮询。
   * - 连接建立即推送一次当前快照（事件名 mcp-status，负载同 GET .../mcp）
   * - 之后每当 mcpEvents 发出 changed（建连落定 / select / exit）重算快照再推
   * - 25s 心跳注释行保活；客户端断开时退订并停心跳
   * 事件以"快照可能已变"为语义，推送时在回调时刻按当时选中重算，
   * 因此建连事件与切换事件交错时也不会把旧数字人的状态推给前端。
   */
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

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });
}
